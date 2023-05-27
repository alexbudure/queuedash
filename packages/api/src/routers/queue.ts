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
  action: (queue: Bull.Queue | BullMQ.Queue | BeeQueue) => void
) => {
  return procedure
    .input(
      z.object({
        queueName: z.string(),
      })
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
          "paused",
        ] as const),
      })
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
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        await queueInCtx.queue.clean(0, status);
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
  addJob: procedure
    .input(
      z.object({
        queueName: z.string(),
        data: z.object({}).passthrough(),
      })
    )
    .mutation(async ({ input: { queueName, data }, ctx: { queues } }) => {
      const queueInCtx = findQueueInCtxOrFail({
        queues,
        queueName,
      });

      try {
        if ("add" in queueInCtx.queue) {
          await queueInCtx.queue.add(data, {});
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

  byName: procedure
    .input(
      z.object({
        queueName: z.string(),
      })
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

        const client = isBee
          ? queueInCtx.queue.settings.redis
          : await queueInCtx.queue.client;
        const info = await client.info();
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const parsedInfo: RedisInfo & {
          maxclients: string;
        } = parse(info);

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
            waiting: counts.waiting,
            paused: "paused" in counts ? counts.paused : 0,
          },
          client: {
            usedMemoryPercentage:
              Number(parsedInfo.used_memory) /
              Number(parsedInfo.total_system_memory),
            usedMemoryHuman: parsedInfo.used_memory_human,
            totalMemoryHuman: parsedInfo.total_system_memory_human,
            uptimeInSeconds: Number(parsedInfo.uptime_in_seconds),
            connectedClients: Number(parsedInfo.connected_clients),
            blockedClients: Number(parsedInfo.blocked_clients),
            maxClients: parsedInfo.maxclients
              ? Number(parsedInfo.maxclients)
              : 0,
            version: parsedInfo.redis_version,
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
