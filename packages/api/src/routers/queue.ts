import { procedure, router, transformContext } from "../trpc";
import { z } from "zod";
import { findQueueInCtxOrFail } from "../utils/global.utils";
import { TRPCError } from "@trpc/server";
import type { RedisInfo } from "redis-info";

export const queueRouter = router({
  clean: procedure
    .input(
      z.object({
        queueName: z.string(),
        status: z.string(),
      }),
    )
    .mutation(async ({ input: { queueName, status }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.clean) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support cleaning jobs`,
        });
      }

      if (!queueInCtx.adapter.canCleanStatus(status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support cleaning jobs with status "${status}"`,
        });
      }

      try {
        await queueInCtx.adapter.clean(status, 0);
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
  empty: procedure
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .mutation(async ({ input: { queueName }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      try {
        await queueInCtx.adapter.empty();
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
    }),
  pause: procedure
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .mutation(async ({ input: { queueName }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.pause) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support pausing`,
        });
      }

      try {
        await queueInCtx.adapter.pause();
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
    }),
  pauseAll: procedure.mutation(async ({ ctx }) => {
    const internalCtx = transformContext(ctx);
    await Promise.all(
      internalCtx.queues.map((q) => {
        if (q.adapter.supports.pause) {
          return q.adapter.pause();
        }
        return null;
      }),
    );
    return "ok";
  }),
  resume: procedure
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .mutation(async ({ input: { queueName }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.resume) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support resuming`,
        });
      }

      try {
        await queueInCtx.adapter.resume();
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
    }),
  resumeAll: procedure.mutation(async ({ ctx }) => {
    const internalCtx = transformContext(ctx);
    await Promise.all(
      internalCtx.queues.map((q) => {
        if (q.adapter.supports.resume) {
          return q.adapter.resume();
        }
        return null;
      }),
    );
    return "ok";
  }),
  addJob: procedure
    .input(
      z.object({
        queueName: z.string(),
        data: z.object({}).passthrough(),
      }),
    )
    .mutation(async ({ input: { queueName, data }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      try {
        await queueInCtx.adapter.addJob(data);
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
    .mutation(async ({ input: { queueName, template, opts }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.schedulers) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support job schedulers`,
        });
      }

      try {
        await queueInCtx.adapter.addScheduler?.(
          `scheduler-${Date.now()}`,
          opts || {},
          template,
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
    }),

  byName: procedure
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .query(async ({ input: { queueName }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      try {
        const [counts, isPaused, redisInfo] = await Promise.all([
          queueInCtx.adapter.getJobCounts(),
          queueInCtx.adapter.isPaused(),
          queueInCtx.adapter.getRedisInfo(),
        ]);

        const info: RedisInfo & { maxclients: string } = {
          ...redisInfo,
          maxclients: redisInfo.maxclients || "0",
        };

        return {
          displayName: queueInCtx.adapter.getDisplayName(),
          name: queueInCtx.adapter.getName(),
          paused: isPaused,
          type: queueInCtx.adapter.getType(),
          supports: queueInCtx.adapter.supports,
          counts: {
            active: counts.active || 0,
            completed: counts.completed || 0,
            delayed: counts.delayed || 0,
            failed: counts.failed || 0,
            waiting: counts.waiting || 0,
            prioritized: counts.prioritized || 0,
            "waiting-children": counts["waiting-children"] || 0,
            paused: counts.paused || 0,
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
  list: procedure.query(async ({ ctx }) => {
    const internalCtx = transformContext(ctx);
    return internalCtx.queues.map((q) => {
      return {
        displayName: q.adapter.getDisplayName(),
        name: q.adapter.getName(),
      };
    });
  }),
  metrics: procedure
    .input(
      z.object({
        queueName: z.string(),
        type: z.enum(["completed", "failed"]),
        start: z.number(),
        end: z.number(),
      }),
    )
    .query(async ({ input: { queueName, type, start, end }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.metrics) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support metrics`,
        });
      }

      if (!queueInCtx.adapter.getMetrics) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "getMetrics method not implemented",
        });
      }

      try {
        return await queueInCtx.adapter.getMetrics(type, start, end);
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: e instanceof Error ? e.message : undefined,
        });
      }
    }),
});
