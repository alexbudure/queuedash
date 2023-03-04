import { procedure, router } from "../trpc";
import type Bull from "bull";
import type BullMQ from "bullmq";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { findQueueInCtxOrFail, formatJob } from "../utils/global.utils";
import type BeeQueue from "bee-queue";

const generateJobMutationProcedure = (
  action: (
    job: Bull.Job | BullMQ.Job | BeeQueue.Job<Record<string, unknown>>
  ) => Promise<unknown> | void
) => {
  return procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
      })
    )
    .mutation(async ({ input: { jobId, queueName }, ctx: { queues } }) => {
      const queueInCtx = findQueueInCtxOrFail({
        queues,
        queueName,
      });

      const job = await queueInCtx.queue.getJob(jobId);

      if (!job) {
        throw new TRPCError({
          code: "BAD_REQUEST",
        });
      }

      try {
        await action(job);
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

      return formatJob({ job, queueInCtx });
    });
};

export const jobRouter = router({
  retry: generateJobMutationProcedure(async (job) => {
    if ("isFailed" in job) {
      if (await job.isFailed()) {
        await job.retry();
      } else {
        throw new TRPCError({
          code: "BAD_REQUEST",
        });
      }
    } else {
      throw new Error(""); // TODO:
    }
  }),
  discard: generateJobMutationProcedure((job) => {
    if ("discard" in job) {
      return job.discard();
    } else {
      return job.remove();
    }
  }),
  rerun: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
      })
    )
    .mutation(async ({ input: { jobId, queueName }, ctx: { queues } }) => {
      const queueInCtx = findQueueInCtxOrFail({
        queues,
        queueName,
      });

      const job = await queueInCtx.queue.getJob(jobId);

      if (!job) {
        throw new TRPCError({
          code: "BAD_REQUEST",
        });
      }

      try {
        if ("add" in queueInCtx.queue) {
          await queueInCtx.queue.add(job.data, {});
        } else {
          await queueInCtx.queue.createJob(job.data);
        }
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

      return formatJob({ job, queueInCtx });
    }),
  promote: generateJobMutationProcedure((job) => {
    if ("promote" in job) {
      return job.promote();
    } else {
      throw new Error(""); // TODO:
    }
  }),
  remove: generateJobMutationProcedure((job) => job.remove()),
  bulkRemove: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobIds: z.array(z.string()),
      })
    )
    .mutation(async ({ input: { jobIds, queueName }, ctx: { queues } }) => {
      const queueInCtx = findQueueInCtxOrFail({
        queues,
        queueName,
      });

      try {
        const jobs = await Promise.all(
          jobIds.map(async (jobId) => {
            const job = await queueInCtx.queue.getJob(jobId);

            if (!job) {
              throw new TRPCError({
                code: "BAD_REQUEST",
              });
            }
            await job.remove();

            return job;
          })
        );
        return jobs.map((job) => formatJob({ job, queueInCtx }));
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
    }),
  list: procedure
    .input(
      z.object({
        queueName: z.string(),
        cursor: z.number().min(0).optional().default(0),
        limit: z.number().min(0).max(100),
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
    .query(
      async ({
        input: { queueName, status, limit, cursor },
        ctx: { queues },
      }) => {
        const queueInCtx = findQueueInCtxOrFail({
          queues,
          queueName,
        });

        if (queueInCtx.type === "bee") {
          throw new Error(""); // TODO:
        }

        try {
          const [jobs, totalCountWithWrongType] = await Promise.all([
            queueInCtx.queue.getJobs([status], cursor, cursor + limit - 1),
            queueInCtx.queue.getJobCountByTypes(status),
          ]);
          const totalCount = totalCountWithWrongType as unknown as number;

          const hasNextPage = jobs.length > 0 && cursor + limit < totalCount;

          return {
            totalCount,
            numOfPages: Math.ceil(totalCount / limit),
            nextCursor: hasNextPage ? cursor + limit : undefined,
            jobs: jobs.map((job) => formatJob({ job, queueInCtx })),
          };
        } catch (e) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: e instanceof Error ? e.message : undefined,
          });
        }
      }
    ),
});
