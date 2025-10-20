import { procedure, router } from "../trpc";
import type Bull from "bull";
import type BullMQ from "bullmq";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { findQueueInCtxOrFail, formatJob } from "../utils/global.utils";
import type BeeQueue from "bee-queue";
import { createClient } from "redis";
import type { Job as GroupMQJob } from "groupmq";

const generateJobMutationProcedure = (
  action: (
    job:
      | Bull.Job
      | BullMQ.Job
      | BeeQueue.Job<Record<string, unknown>>
      | GroupMQJob,
  ) => Promise<unknown> | void,
) => {
  return procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
      }),
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
    if ("retry" in job) {
      if ("isFailed" in job) {
        if (await job.isFailed()) await job.retry();
      } else {
        await job.retry();
      }
    } else {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Bee-Queue does not support retrying jobs",
      });
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
      }),
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
        if (queueInCtx.type === "bee") {
          await queueInCtx.queue.createJob(job.data).save();
        } else if (queueInCtx.type === "bullmq" && "name" in job) {
          await queueInCtx.queue.add(job.name, job.data, {});
        } else if (queueInCtx.type === "groupmq") {
          await queueInCtx.queue.add({
            groupId:
              job.data.groupId || Math.random().toString(36).substring(2, 8),
            data: job.data,
          });
        } else {
          await queueInCtx.queue.add(job.data, {});
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
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Bee-Queue does not support promoting jobs",
      });
    }
  }),
  remove: generateJobMutationProcedure((job) => job.remove()),
  bulkRemove: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobIds: z.array(z.string()),
      }),
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
          }),
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
  logs: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
      }),
    )
    .query(async ({ input: { queueName, jobId }, ctx: { queues } }) => {
      const queueInCtx = findQueueInCtxOrFail({
        queues,
        queueName,
      });
      if (queueInCtx.type !== "bullmq") {
        return null;
      }
      const { logs } = await queueInCtx.queue.getJobLogs(jobId);

      return logs;
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
          "prioritized",
          "waiting",
          "waiting-children",
          "paused",
        ] as const),
      }),
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

        // GroupMQ handling
        if (queueInCtx.type === "groupmq") {
          try {
            const jobs = await queueInCtx.queue.getJobsByStatus(
              [status],
              cursor,
              cursor + limit - 1,
            );
            const counts = await queueInCtx.queue.getJobCounts();
            const totalCount = counts[status] || 0;

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

        // Bee-Queue handling
        if (queueInCtx.type === "bee") {
          try {
            const normalizedStatus =
              status === "completed" ? "succeeded" : status;
            const client = createClient(queueInCtx.queue.settings.redis);

            const [jobs] = await Promise.all([
              queueInCtx.queue.getJobs(normalizedStatus, {
                start: cursor,
                end: cursor + limit - 1,
                size: limit,
              }),
              client.connect(),
            ]);

            // Bee-Queue stores different statuses in different Redis structures
            // waiting/active use lists (LLEN), others use sets (SCARD)
            const prefix = queueInCtx.queue.settings.keyPrefix;
            let totalCount: number;

            if (
              normalizedStatus === "waiting" ||
              normalizedStatus === "active"
            ) {
              // These are stored as Redis lists
              totalCount = await client.lLen(`${prefix}${normalizedStatus}`);
            } else {
              // succeeded, failed, delayed are stored as Redis sets
              totalCount = await client.sCard(`${prefix}${normalizedStatus}`);
            }

            await client.disconnect();

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

        // Bull/BullMQ handling
        try {
          const isBullMq = queueInCtx.type === "bullmq";

          const [jobs, totalCountWithWrongType] = await Promise.all([
            (status === "prioritized" || status === "waiting-children") &&
            isBullMq
              ? queueInCtx.queue.getJobs([status], cursor, cursor + limit - 1)
              : status === "prioritized" || status === "waiting-children"
                ? []
                : queueInCtx.queue.getJobs(
                    [status],
                    cursor,
                    cursor + limit - 1,
                  ),
            (status === "prioritized" || status === "waiting-children") &&
            isBullMq
              ? queueInCtx.queue.getJobCountByTypes(status)
              : status === "prioritized" || status === "waiting-children"
                ? 0
                : queueInCtx.queue.getJobCountByTypes(status),
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
      },
    ),
});
