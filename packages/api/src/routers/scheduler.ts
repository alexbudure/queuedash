import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assertQueueActionAllowed } from "../access";
import { presentErrorMessage, presentScheduler } from "../presentation";
import type { SchedulerInfo } from "../queue-adapters/base.adapter";
import {
  schedulerOptionsSchema,
  schedulerTemplateSchema,
} from "../scheduler.schemas";
import { procedure, router, transformContext } from "../trpc";
import { findQueueInCtxOrFail } from "../utils/global.utils";

export const schedulerRouter = router({
  list: procedure
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .query(async ({ input: { queueName }, ctx }): Promise<SchedulerInfo[]> => {
      const internalCtx = await transformContext(ctx);
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

      return ((await queueInCtx.adapter.getSchedulers?.()) || []).map(
        (scheduler) => presentScheduler(scheduler, internalCtx.privacy),
      );
    }),

  add: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobName: z.string().trim().min(1),
        data: z.record(z.string(), z.unknown()),
        pattern: z.string().trim().min(1).optional(),
        every: z.number().positive().optional(),
        tz: z.string().trim().min(1).optional(),
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

      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "scheduler.add");
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
      if (!queueInCtx.adapter.addScheduler) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Scheduler support is not implemented for this queue",
        });
      }

      await queueInCtx.adapter.addScheduler(
        `scheduler-${Date.now()}`,
        { pattern, every, tz },
        { name: jobName, data },
      );

      return { success: true };
    }),

  update: procedure
    .input(
      z.object({
        queueName: z.string(),
        key: z.string().min(1),
        template: schedulerTemplateSchema,
        opts: schedulerOptionsSchema,
      }),
    )
    .mutation(async ({ input: { queueName, key, template, opts }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "scheduler.update");
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (
        !queueInCtx.adapter.supports.schedulerUpdate ||
        !queueInCtx.adapter.updateScheduler
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support updating job schedulers`,
        });
      }

      try {
        const schedulers = await queueInCtx.adapter.getSchedulers?.();
        if (!schedulers?.some((scheduler) => scheduler.key === key)) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Job scheduler not found",
          });
        }
        await queueInCtx.adapter.updateScheduler(key, opts, template);
        return { success: true };
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: presentErrorMessage(e, internalCtx.privacy),
        });
      }
    }),

  remove: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobSchedulerId: z.string(),
      }),
    )
    .mutation(async ({ input: { queueName, jobSchedulerId }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "scheduler.remove");
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
          message: presentErrorMessage(e, internalCtx.privacy),
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
        const internalCtx = await transformContext(ctx);
        assertQueueActionAllowed(internalCtx, queueName, "scheduler.remove");
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

          return schedulersToRemove.map((scheduler) =>
            presentScheduler(scheduler, internalCtx.privacy),
          );
        } catch (e) {
          if (e instanceof TRPCError) {
            throw e;
          } else {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: presentErrorMessage(e, internalCtx.privacy),
            });
          }
        }
      },
    ),
});
