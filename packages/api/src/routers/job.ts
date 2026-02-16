import { procedure, router, transformContext } from "../trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { findQueueInCtxOrFail } from "../utils/global.utils";
import type { AdaptedJob } from "../queue-adapters/base.adapter";

const JOB_STATUSES = [
  "completed",
  "failed",
  "delayed",
  "active",
  "prioritized",
  "waiting",
  "waiting-children",
  "paused",
] as const;

type JobListStatus = (typeof JOB_STATUSES)[number];

const JOB_SCAN_BATCH_SIZE = 1000;

const getJobsPage = async (
  adapter: {
    getJobs: (status: never, start: number, end: number) => Promise<unknown[]>;
  },
  status: JobListStatus,
  start: number,
  end: number,
): Promise<AdaptedJob[]> => {
  const jobs = await adapter.getJobs(status as never, start, end);
  return jobs as AdaptedJob[];
};

const getAllJobsForStatus = async (
  adapter: {
    getJobs: (status: never, start: number, end: number) => Promise<unknown[]>;
  },
  status: JobListStatus,
): Promise<AdaptedJob[]> => {
  const jobs: AdaptedJob[] = [];
  let start = 0;

  while (true) {
    const chunk = await getJobsPage(
      adapter,
      status,
      start,
      start + JOB_SCAN_BATCH_SIZE - 1,
    );

    if (chunk.length === 0) {
      break;
    }

    jobs.push(...chunk);

    if (chunk.length < JOB_SCAN_BATCH_SIZE) {
      break;
    }

    start += JOB_SCAN_BATCH_SIZE;
  }

  return jobs;
};

export const jobRouter = router({
  retry: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
      }),
    )
    .mutation(async ({ input: { jobId, queueName }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.retry) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support retrying jobs`,
        });
      }

      try {
        await queueInCtx.adapter.retryJob(jobId);
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

      const job = await queueInCtx.adapter.getJob(jobId);
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }
      return job;
    }),
  discard: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
      }),
    )
    .mutation(async ({ input: { jobId, queueName }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      try {
        await queueInCtx.adapter.discardJob(jobId);
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

      const job = await queueInCtx.adapter.getJob(jobId);
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }
      return job;
    }),
  rerun: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
      }),
    )
    .mutation(async ({ input: { jobId, queueName }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      const job = await queueInCtx.adapter.getJob(jobId);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      try {
        await queueInCtx.adapter.addJob(job.data);
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

      return job;
    }),
  promote: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
      }),
    )
    .mutation(async ({ input: { jobId, queueName }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.promote) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support promoting jobs`,
        });
      }

      try {
        await queueInCtx.adapter.promoteJob(jobId);
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

      const job = await queueInCtx.adapter.getJob(jobId);
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }
      return job;
    }),
  remove: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
      }),
    )
    .mutation(async ({ input: { jobId, queueName }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      const job = await queueInCtx.adapter.getJob(jobId);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      try {
        await queueInCtx.adapter.removeJob(jobId);
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

      return job;
    }),
  bulkRemove: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ input: { jobIds, queueName }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      try {
        const jobs = await Promise.all(
          jobIds.map(async (jobId) => {
            const job = await queueInCtx.adapter.getJob(jobId);

            if (!job) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: `Job ${jobId} not found`,
              });
            }
            await queueInCtx.adapter.removeJob(jobId);

            return job;
          }),
        );
        return jobs;
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
  bulkRetry: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ input: { jobIds, queueName }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.retry) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support retrying jobs`,
        });
      }

      try {
        const results = await Promise.allSettled(
          jobIds.map(async (jobId) => {
            await queueInCtx.adapter.retryJob(jobId);
            return jobId;
          }),
        );

        const succeeded = results
          .filter((r) => r.status === "fulfilled")
          .map((r) => (r as PromiseFulfilledResult<string>).value);
        const failed = results.filter((r) => r.status === "rejected").length;

        return { succeeded: succeeded.length, failed };
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
  bulkRetryByFilter: procedure
    .input(
      z.object({
        queueName: z.string(),
        status: z.literal("failed"),
        groupId: z.string().optional(),
      }),
    )
    .mutation(async ({ input: { queueName, status, groupId }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.retry) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support retrying jobs`,
        });
      }

      try {
        const allFailedJobs = await getAllJobsForStatus(queueInCtx.adapter, status);
        const jobsToRetry = groupId
          ? allFailedJobs.filter((job) => job.groupId === groupId)
          : allFailedJobs;

        const results = await Promise.allSettled(
          jobsToRetry.map(async (job) => {
            await queueInCtx.adapter.retryJob(job.id);
            return job.id;
          }),
        );

        const succeeded = results.filter((r) => r.status === "fulfilled").length;
        const failed = results.filter((r) => r.status === "rejected").length;

        return { total: jobsToRetry.length, succeeded, failed };
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
  bulkRemoveByGroup: procedure
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input: { queueName, groupId }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      try {
        const uniqueJobIds = new Set<string>();

        for (const status of queueInCtx.adapter.supports
          .statuses as JobListStatus[]) {
          const jobs = await getAllJobsForStatus(queueInCtx.adapter, status);
          for (const job of jobs) {
            if (job.groupId === groupId) {
              uniqueJobIds.add(job.id);
            }
          }
        }

        const jobIds = Array.from(uniqueJobIds);
        const results = await Promise.allSettled(
          jobIds.map(async (jobId) => {
            await queueInCtx.adapter.removeJob(jobId);
            return jobId;
          }),
        );

        const succeeded = results.filter((r) => r.status === "fulfilled").length;
        const failed = results.filter((r) => r.status === "rejected").length;

        return { total: jobIds.length, succeeded, failed };
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
  byId: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
      }),
    )
    .query(async ({ input: { queueName, jobId }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      try {
        const job = await queueInCtx.adapter.getJob(jobId);
        return job;
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: e instanceof Error ? e.message : undefined,
        });
      }
    }),
  logs: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
      }),
    )
    .query(async ({ input: { queueName, jobId }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.logs) {
        return null;
      }

      return await queueInCtx.adapter.getJobLogs(jobId);
    }),
  list: procedure
    .input(
      z.object({
        queueName: z.string(),
        cursor: z.number().min(0).optional().default(0),
        limit: z.number().min(1).max(100),
        status: z.enum(JOB_STATUSES),
        groupId: z.string().optional(),
      }),
    )
    .query(async ({ input: { queueName, status, limit, cursor, groupId }, ctx }) => {
      const internalCtx = transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      try {
        if (groupId) {
          const allJobsInStatus = await getAllJobsForStatus(queueInCtx.adapter, status);
          const filteredJobs = allJobsInStatus.filter(
            (job) => job.groupId === groupId,
          );

          const jobs = filteredJobs.slice(cursor, cursor + limit);
          const totalCount = filteredJobs.length;
          const hasNextPage = cursor + limit < totalCount;

          return {
            totalCount,
            numOfPages: Math.ceil(totalCount / limit),
            nextCursor: hasNextPage ? cursor + limit : undefined,
            jobs,
          };
        }

        const jobs = await queueInCtx.adapter.getJobs(
          status,
          cursor,
          cursor + limit - 1,
        );
        const counts = await queueInCtx.adapter.getJobCounts();
        const totalCount = counts[status] || 0;

        const hasNextPage = cursor + limit < totalCount;

        return {
          totalCount,
          numOfPages: Math.ceil(totalCount / limit),
          nextCursor: hasNextPage ? cursor + limit : undefined,
          jobs,
        };
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: e instanceof Error ? e.message : undefined,
        });
      }
    }),
});
