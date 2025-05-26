import { procedure, router } from "../trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { QueueDashScheduler } from "../utils/global.utils";
import { findQueueInCtxOrFail } from "../utils/global.utils";

export const schedulerRouter = router({
  list: procedure
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .query(
      async ({
        input: { queueName },
        ctx: { queues },
      }): Promise<QueueDashScheduler[]> => {
        const queueInCtx = findQueueInCtxOrFail({ queues, queueName });

        if (queueInCtx.type !== "bullmq") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Scheduled jobs are only supported for BullMQ queues",
          });
        }

        return queueInCtx.queue.getJobSchedulers();
      },
    ),

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
    .mutation(async ({ input, ctx: { queues } }) => {
      const { queueName, jobName, data, pattern, every, tz } = input;

      if (!pattern && !every) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You must provide either `cron` or `every`",
        });
      }

      const queueInCtx = findQueueInCtxOrFail({ queues, queueName });

      if (queueInCtx.type !== "bullmq") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Scheduled jobs are only supported for BullMQ queues",
        });
      }

      await queueInCtx.queue.add(jobName, data, {
        repeat: { pattern, every, tz },
      });

      return { success: true };
    }),

  remove: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobSchedulerId: z.string(),
      }),
    )
    .mutation(
      async ({ input: { queueName, jobSchedulerId }, ctx: { queues } }) => {
        const queueInCtx = findQueueInCtxOrFail({ queues, queueName });

        if (queueInCtx.type !== "bullmq") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Scheduled jobs are only supported for BullMQ queues",
          });
        }

        try {
          await queueInCtx.queue.removeJobScheduler(jobSchedulerId);
          return { success: true };
        } catch (e) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: e instanceof Error ? e.message : undefined,
          });
        }
      },
    ),

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
        ctx: { queues },
      }): Promise<QueueDashScheduler[]> => {
        const queueInCtx = findQueueInCtxOrFail({
          queues,
          queueName,
        });

        if (queueInCtx.type !== "bullmq") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Scheduled jobs are only supported for BullMQ queues",
          });
        }

        try {
          return Promise.all(
            jobSchedulerIds.map(async (jobSchedulerId) => {
              const scheduler =
                await queueInCtx.queue.getJobScheduler(jobSchedulerId);

              if (!scheduler) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                });
              }
              await queueInCtx.queue.removeJobScheduler(jobSchedulerId);

              return scheduler;
            }),
          );
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
