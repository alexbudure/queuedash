import { procedure, router } from "../trpc";
import { z } from "zod";
import { findQueueInCtxOrFail } from "../utils/global.utils";
import type Bull from "bull";
import type BullMQ from "bullmq";
import { TRPCError } from "@trpc/server";
import type BeeQueue from "bee-queue";
import type { RedisInfo } from "redis-info";
import { parse } from "redis-info";

const generateQueueMutationProcedure = (
  action: (queue: Bull.Queue | BullMQ.Queue | BeeQueue) => void,
) => {
  return procedure
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .mutation(async ({ input: { queueName }, ctx: { queues } }) => {
      const queueInCtx = findQueueInCtxOrFail({
        queues,
        queueName,
      });

      try {
        await action(queueInCtx.queue);
      } catch (e) {
        if (e instanceof TRPCError) {
          throw e;
        } else {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: e instanceof Error ? e.message : undefined,
          });
        }
      }

      return {
        name: queueName,
      };
    });
};

export const queueRouter = router({
  clean: procedure
    .input(
      z.object({
        queueName: z.string(),
        status: z.enum([
          "completed",
          "failed",
          "delayed",
          "active",
          "waiting",
          "waiting-children",
          "prioritized",
          "paused",
        ] as const),
      }),
    )
    .mutation(async ({ input: { queueName, status }, ctx: { queues } }) => {
      const queueInCtx = findQueueInCtxOrFail({
        queues,
        queueName,
      });

      if (queueInCtx.type === "bee") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot clean Bee-Queue queues",
        });
      }

      try {
        if (queueInCtx.type === "bullmq") {
          await queueInCtx.queue.clean(
            0,
            0,
            status === "waiting" || status === "waiting-children"
              ? "wait"
              : status,
          );
        } else if (status !== "prioritized" && status !== "waiting-children") {
          await queueInCtx.queue.clean(
            0,
            status === "waiting" ? "wait" : status,
          );
        }
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: e instanceof Error ? e.message : undefined,
        });
      }

      return {
        name: queueName,
      };
    }),
  empty: generateQueueMutationProcedure((queue) => {
    if ("empty" in queue) {
      return queue.empty();
    } else if ("drain" in queue) {
      return queue.drain();
    } else {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot empty Bee-Queue queues",
      });
    }
  }),
  pause: generateQueueMutationProcedure((queue) => {
    if ("pause" in queue) {
      return queue.pause();
    } else {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot pause Bee-Queue queues",
      });
    }
  }),
  pauseAll: procedure.mutation(async ({ ctx: { queues } }) => {
    await Promise.all([
      queues.map((queue) => {
        if ("pause" in queue.queue) {
          return queue.queue.pause();
        } else {
          return null;
        }
      }),
    ]);
    return "ok";
  }),
  resume: generateQueueMutationProcedure((queue) => {
    if ("resume" in queue) {
      return queue.resume();
    } else {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot resume Bee-Queue queues",
      });
    }
  }),
  resumeAll: procedure.mutation(async ({ ctx: { queues } }) => {
    await Promise.all([
      queues.map((queue) => {
        if ("resume" in queue.queue) {
          return queue.queue.resume();
        } else {
          return null;
        }
      }),
    ]);
    return "ok";
  }),
  addJob: procedure
    .input(
      z.object({
        queueName: z.string(),
        data: z.object({}).passthrough(),
      }),
    )
    .mutation(async ({ input: { queueName, data }, ctx: { queues } }) => {
      const queueInCtx = findQueueInCtxOrFail({
        queues,
        queueName,
      });

      try {
        if ("add" in queueInCtx.queue) {
          if (queueInCtx.type === "bullmq") {
            queueInCtx.queue.add("Manual add", data);
          } else {
            await queueInCtx.queue.add(data, {});
          }
        } else {
          await queueInCtx.queue.createJob(data).save();
        }
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: e instanceof Error ? e.message : undefined,
        });
      }

      return {
        name: queueName,
      };
    }),

  addJobScheduler: procedure
    .input(
      z.object({
        queueName: z.string(),
        template: z.object({
          name: z.string().optional(),
          data: z.any(),
          opts: z.any().optional(),
        }),
        opts: z
          .object({
            every: z.number().optional(),
            pattern: z.string().optional(),
            tz: z.string().optional(),
          })
          .optional(),
      }),
    )
    .mutation(
      async ({ input: { queueName, template, opts }, ctx: { queues } }) => {
        const queueInCtx = findQueueInCtxOrFail({
          queues,
          queueName,
        });

        if (queueInCtx.type !== "bullmq") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Job schedulers are only supported for BullMQ queues",
          });
        }

        try {
          await queueInCtx.queue.upsertJobScheduler(
            `scheduler-${Date.now()}`,
            {
              every: opts?.every,
              pattern: opts?.pattern,
              tz: opts?.tz,
            },
            {
              name: template.name,
              data: template.data,
              opts: template.opts,
            },
          );
        } catch (e) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: e instanceof Error ? e.message : undefined,
          });
        }

        return {
          name: queueName,
        };
      },
    ),

  byName: procedure
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .query(async ({ input: { queueName }, ctx: { queues } }) => {
      const queueInCtx = findQueueInCtxOrFail({
        queues,
        queueName,
      });

      const isBee = queueInCtx.type === "bee";

      try {
        const [counts, isPaused] = await Promise.all([
          isBee
            ? queueInCtx.queue.checkHealth()
            : queueInCtx.queue.getJobCounts(),
          isBee ? queueInCtx.queue.paused : queueInCtx.queue.isPaused(),
        ]);

        const info: RedisInfo & {
          maxclients: string;
        } = isBee
          ? // @ts-expect-error Bee-Queue does not have a client property
            queueInCtx.queue.client.server_info
          : queueInCtx.type === "bullmq"
            ? parse(await (await queueInCtx.queue.client).info())
            : parse(await queueInCtx.queue.client.info());

        return {
          displayName: queueInCtx.displayName,
          name: queueInCtx.queue.name,
          paused: isPaused,
          type: queueInCtx.type,
          counts: {
            active: counts.active,
            completed:
              "completed" in counts ? counts.completed : counts.succeeded,
            delayed: counts.delayed,
            failed: counts.failed,
            ...("prioritized" in counts
              ? { prioritized: counts.prioritized }
              : {}),
            waiting: counts.waiting,
            ...("waiting-children" in counts
              ? { "waiting-children": counts["waiting-children"] }
              : {}),
            paused: "paused" in counts ? counts.paused : 0,
          },
          client: {
            usedMemoryPercentage:
              Number(info.used_memory) / Number(info.total_system_memory),
            usedMemoryHuman: info.used_memory_human,
            totalMemoryHuman: info.total_system_memory_human,
            uptimeInSeconds: Number(info.uptime_in_seconds),
            connectedClients: Number(info.connected_clients),
            blockedClients: Number(info.blocked_clients),
            maxClients: info.maxclients ? Number(info.maxclients) : 0,
            version: info.redis_version,
          },
        };
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: e instanceof Error ? e.message : undefined,
        });
      }
    }),
  list: procedure.query(async ({ ctx: { queues } }) => {
    return queues.map((queue) => {
      return {
        displayName: queue.displayName,
        name: queue.queue.name,
      };
    });
  }),
});
