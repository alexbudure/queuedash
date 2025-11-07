import { procedure, router, transformContext } from "../trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { findQueueInCtxOrFail } from "../utils/global.utils";
import type { SchedulerInfo } from "../queue-adapters/base.adapter";

export const schedulerRouter = router({
  list: procedure
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .query(async ({ input: { queueName }, ctx }): Promise<SchedulerInfo[]> => {
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

      return (await queueInCtx.adapter.getSchedulers?.()) || [];
    }),

  add: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobName: z.string(),
        data: z.record(z.any()),
        pattern: z.string().optional(),
        every: z.number().optional(),
        tz: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { queueName, jobName, data, pattern, every, tz } = input;

      if (!pattern && !every) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You must provide either `pattern` or `every`",
        });
      }

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

      await queueInCtx.adapter.addScheduler?.(
        `scheduler-${Date.now()}`,
        { pattern, every, tz },
        { name: jobName, data },
      );

      return { success: true };
    }),

  remove: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobSchedulerId: z.string(),
      }),
    )
    .mutation(async ({ input: { queueName, jobSchedulerId }, ctx }) => {
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
        await queueInCtx.adapter.removeScheduler?.(jobSchedulerId);
        return { success: true };
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: e instanceof Error ? e.message : undefined,
        });
      }
    }),

  bulkRemove: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobSchedulerIds: z.array(z.string()),
      }),
    )
    .mutation(
      async ({
        input: { jobSchedulerIds, queueName },
        ctx,
      }): Promise<SchedulerInfo[]> => {
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
          const schedulers = await queueInCtx.adapter.getSchedulers?.();
          const schedulersToRemove = schedulers?.filter((s) =>
            jobSchedulerIds.includes(s.key),
          );

          if (!schedulersToRemove || schedulersToRemove.length === 0) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "No schedulers found with provided IDs",
            });
          }

          await Promise.all(
            jobSchedulerIds.map((id) =>
              queueInCtx.adapter.removeScheduler?.(id),
            ),
          );

          return schedulersToRemove;
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
      },
    ),
});
