import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assertQueueActionAllowed } from "../access";
import { presentErrorMessage, presentJob, presentLogs } from "../presentation";
import type { AdaptedJob } from "../queue-adapters/base.adapter";
import type { InternalContext } from "../trpc";
import { procedure, router, transformContext } from "../trpc";
import { findQueueInCtxOrFail } from "../utils/global.utils";

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
const JOB_SEARCH_BATCH_SIZE = 100;
const MAX_JOB_SCAN_LIMIT = 5_000;
const BULK_ACTION_CONCURRENCY = 25;

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

const getEffectiveScanLimit = (
  ctx: InternalContext,
  requestedLimit: number,
): number =>
  Math.min(
    requestedLimit,
    Math.min(
      Math.max(ctx.search?.maxScanned ?? MAX_JOB_SCAN_LIMIT, 25),
      MAX_JOB_SCAN_LIMIT,
    ),
  );

const getSearchText = (
  job: AdaptedJob,
  searchInData: boolean = true,
): string => {
  try {
    return JSON.stringify(
      {
        id: job.id,
        name: job.name,
        groupId: job.groupId,
        failedReason: job.failedReason,
        ...(searchInData
          ? { data: job.data, returnValue: job.returnValue }
          : {}),
      },
      (_key, value) =>
        typeof value === "bigint" ? value.toString() : (value as unknown),
    ).toLocaleLowerCase();
  } catch {
    return `${job.id} ${job.name} ${job.groupId ?? ""}`.toLocaleLowerCase();
  }
};

type FilteredJob = {
  presented: AdaptedJob;
  raw: AdaptedJob;
};

const scanJobsForStatus = async ({
  adapter,
  groupId,
  maxScanned,
  privacy,
  query,
  searchInData = true,
  status,
}: {
  adapter: Parameters<typeof getJobsPage>[0];
  groupId?: string;
  maxScanned: number;
  privacy: InternalContext["privacy"];
  query?: string;
  searchInData?: boolean;
  status: JobListStatus;
}): Promise<{
  jobs: FilteredJob[];
  scanned: number;
  scanLimitReached: boolean;
}> => {
  const normalizedQuery = query?.trim().toLocaleLowerCase();
  const jobs: FilteredJob[] = [];
  let scanned = 0;
  let start = 0;
  let exhausted = false;

  while (scanned < maxScanned) {
    const batchSize = Math.min(JOB_SEARCH_BATCH_SIZE, maxScanned - scanned);
    const page = await getJobsPage(
      adapter,
      status,
      start,
      start + batchSize - 1,
    );

    if (page.length === 0) {
      exhausted = true;
      break;
    }

    scanned += page.length;
    start += page.length;

    for (const raw of page) {
      if (groupId && raw.groupId !== groupId) continue;
      const presented = presentJob(raw, privacy);
      if (
        normalizedQuery &&
        !getSearchText(presented, searchInData).includes(normalizedQuery)
      ) {
        continue;
      }
      jobs.push({ presented, raw });
    }

    if (page.length < batchSize) {
      exhausted = true;
      break;
    }
  }

  let scanLimitReached = false;
  if (!exhausted && scanned >= maxScanned) {
    scanLimitReached =
      (await getJobsPage(adapter, status, start, start)).length > 0;
  }

  return { jobs, scanned, scanLimitReached };
};

const runFilteredJobAction = async ({
  action,
  adapter,
  groupId,
  maxScanned,
  privacy,
  query,
  status,
}: {
  action: (jobId: string) => Promise<void>;
  adapter: Parameters<typeof getJobsPage>[0];
  groupId?: string;
  maxScanned: number;
  privacy: InternalContext["privacy"];
  query?: string;
  status: JobListStatus;
}) => {
  const scan = await scanJobsForStatus({
    adapter,
    groupId,
    maxScanned,
    privacy,
    query,
    status,
  });
  let succeeded = 0;
  for (
    let index = 0;
    index < scan.jobs.length;
    index += BULK_ACTION_CONCURRENCY
  ) {
    const batch = scan.jobs.slice(index, index + BULK_ACTION_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(({ raw }) => action(raw.id)),
    );
    succeeded += results.filter(
      (result) => result.status === "fulfilled",
    ).length;
  }

  return {
    scanned: scan.scanned,
    matched: scan.jobs.length,
    succeeded,
    failed: scan.jobs.length - succeeded,
    partial: scan.scanLimitReached,
    scanLimitReached: scan.scanLimitReached,
  };
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
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "job.retry");
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
            message: presentErrorMessage(e, internalCtx.privacy),
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
      return presentJob(job, internalCtx.privacy);
    }),
  discard: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
      }),
    )
    .mutation(async ({ input: { jobId, queueName }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "job.discard");
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
            message: presentErrorMessage(e, internalCtx.privacy),
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
      return presentJob(job, internalCtx.privacy);
    }),
  rerun: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
      }),
    )
    .mutation(async ({ input: { jobId, queueName }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "job.rerun");
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
            message: presentErrorMessage(e, internalCtx.privacy),
          });
        }
      }

      return presentJob(job, internalCtx.privacy);
    }),
  promote: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
      }),
    )
    .mutation(async ({ input: { jobId, queueName }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "job.promote");
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
        const currentStatus = await queueInCtx.adapter.getJobStatus(jobId);
        if (currentStatus === null) {
          const job = await queueInCtx.adapter.getJob(jobId);
          if (!job) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Job not found",
            });
          }
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Could not verify that the job is delayed",
          });
        }
        if (currentStatus !== "delayed") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Only delayed jobs can be promoted; job is currently ${currentStatus}`,
          });
        }
        await queueInCtx.adapter.promoteJob(jobId);
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

      const job = await queueInCtx.adapter.getJob(jobId);
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }
      return presentJob(job, internalCtx.privacy);
    }),
  bulkPromoteByFilter: procedure
    .input(
      z.object({
        queueName: z.string(),
        status: z.literal("delayed"),
        groupId: z.string().optional(),
        query: z.string().trim().min(1).max(200).optional(),
        maxScanned: z.number().min(25).max(MAX_JOB_SCAN_LIMIT).default(5_000),
      }),
    )
    .mutation(
      async ({
        input: { queueName, status, groupId, query, maxScanned },
        ctx,
      }) => {
        const internalCtx = await transformContext(ctx);
        assertQueueActionAllowed(internalCtx, queueName, "job.promote");
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
        if (!queueInCtx.adapter.supports.statuses.includes(status)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${queueInCtx.adapter.getType()} does not support delayed jobs`,
          });
        }

        try {
          return await runFilteredJobAction({
            action: (jobId) => queueInCtx.adapter.promoteJob(jobId),
            adapter: queueInCtx.adapter,
            groupId,
            maxScanned: getEffectiveScanLimit(internalCtx, maxScanned),
            privacy: internalCtx.privacy,
            query,
            status,
          });
        } catch (e) {
          if (e instanceof TRPCError) throw e;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: presentErrorMessage(e, internalCtx.privacy),
          });
        }
      },
    ),
  remove: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
      }),
    )
    .mutation(async ({ input: { jobId, queueName }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "job.remove");
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
            message: presentErrorMessage(e, internalCtx.privacy),
          });
        }
      }

      return presentJob(job, internalCtx.privacy);
    }),
  bulkRemove: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ input: { jobIds, queueName }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "job.remove");
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

            return presentJob(job, internalCtx.privacy);
          }),
        );
        return jobs;
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
    }),
  bulkRemoveByFilter: procedure
    .input(
      z.object({
        queueName: z.string(),
        status: z.enum(JOB_STATUSES),
        groupId: z.string().optional(),
        query: z.string().trim().min(1).max(200).optional(),
        maxScanned: z.number().min(25).max(MAX_JOB_SCAN_LIMIT).default(5_000),
      }),
    )
    .mutation(
      async ({
        input: { queueName, status, groupId, query, maxScanned },
        ctx,
      }) => {
        const internalCtx = await transformContext(ctx);
        assertQueueActionAllowed(internalCtx, queueName, "job.remove");
        const queueInCtx = findQueueInCtxOrFail({
          queues: internalCtx.queues,
          queueName,
        });

        if (!queueInCtx.adapter.supports.statuses.includes(status)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${queueInCtx.adapter.getType()} does not support the ${status} job status`,
          });
        }

        try {
          return await runFilteredJobAction({
            action: (jobId) => queueInCtx.adapter.removeJob(jobId),
            adapter: queueInCtx.adapter,
            groupId,
            maxScanned: getEffectiveScanLimit(internalCtx, maxScanned),
            privacy: internalCtx.privacy,
            query,
            status,
          });
        } catch (e) {
          if (e instanceof TRPCError) throw e;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: presentErrorMessage(e, internalCtx.privacy),
          });
        }
      },
    ),
  bulkRetry: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ input: { jobIds, queueName }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "job.retry");
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
            message: presentErrorMessage(e, internalCtx.privacy),
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
        query: z.string().trim().min(1).max(200).optional(),
        maxScanned: z.number().min(25).max(MAX_JOB_SCAN_LIMIT).default(5_000),
      }),
    )
    .mutation(
      async ({
        input: { queueName, status, groupId, query, maxScanned },
        ctx,
      }) => {
        const internalCtx = await transformContext(ctx);
        assertQueueActionAllowed(internalCtx, queueName, "job.retry");
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
          const result = await runFilteredJobAction({
            action: (jobId) => queueInCtx.adapter.retryJob(jobId),
            adapter: queueInCtx.adapter,
            groupId,
            maxScanned: getEffectiveScanLimit(internalCtx, maxScanned),
            privacy: internalCtx.privacy,
            query,
            status,
          });
          return { ...result, total: result.matched };
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
  bulkRemoveByGroup: procedure
    .input(
      z.object({
        queueName: z.string(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input: { queueName, groupId }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "job.remove");
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

        const succeeded = results.filter(
          (r) => r.status === "fulfilled",
        ).length;
        const failed = results.filter((r) => r.status === "rejected").length;

        return { total: jobIds.length, succeeded, failed };
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
    }),
  byId: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
      }),
    )
    .query(async ({ input: { queueName, jobId }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      try {
        const job = await queueInCtx.adapter.getJob(jobId);
        return job ? presentJob(job, internalCtx.privacy) : null;
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: presentErrorMessage(e, internalCtx.privacy),
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
      const internalCtx = await transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.logs) {
        return null;
      }

      return presentLogs(
        await queueInCtx.adapter.getJobLogs(jobId),
        internalCtx.privacy,
      );
    }),
  search: procedure
    .input(
      z.object({
        queueName: z.string(),
        query: z.string().trim().min(1).max(200),
        statuses: z.array(z.enum(JOB_STATUSES)).optional(),
        limit: z.number().min(1).max(50).default(25),
        maxScanned: z.number().min(25).max(MAX_JOB_SCAN_LIMIT).default(500),
      }),
    )
    .query(
      async ({
        input: { queueName, query, statuses, limit, maxScanned },
        ctx,
      }) => {
        const internalCtx = await transformContext(ctx);
        const effectiveMaxScanned = getEffectiveScanLimit(
          internalCtx,
          maxScanned,
        );
        const queueInCtx = findQueueInCtxOrFail({
          queues: internalCtx.queues,
          queueName,
        });
        const normalizedQuery = query.toLocaleLowerCase();
        const requestedStatuses = (statuses ?? JOB_STATUSES).filter((status) =>
          queueInCtx.adapter.supports.statuses.includes(status),
        );
        const results: Array<{
          job: AdaptedJob;
          status: JobListStatus | null;
        }> = [];
        const seen = new Set<string>();
        let scanned = 0;
        let scanLimitReached = false;
        let resultLimitReached = false;

        try {
          const exactJob = await queueInCtx.adapter.getJob(query);
          if (exactJob) {
            const presented = presentJob(exactJob, internalCtx.privacy);
            const exactStatus = await queueInCtx.adapter.getJobStatus(query);
            results.push({
              job: presented,
              status: JOB_STATUSES.includes(exactStatus as JobListStatus)
                ? (exactStatus as JobListStatus)
                : null,
            });
            seen.add(presented.id);
          }

          for (const status of requestedStatuses) {
            let start = 0;

            while (scanned < effectiveMaxScanned && results.length < limit) {
              const batchSize = Math.min(
                JOB_SEARCH_BATCH_SIZE,
                effectiveMaxScanned - scanned,
              );
              const jobs = await getJobsPage(
                queueInCtx.adapter,
                status,
                start,
                start + batchSize - 1,
              );
              if (jobs.length === 0) break;

              scanned += jobs.length;
              for (const rawJob of jobs) {
                if (seen.has(rawJob.id)) continue;

                const job = presentJob(rawJob, internalCtx.privacy);
                if (!getSearchText(job).includes(normalizedQuery)) continue;

                results.push({ job, status });
                seen.add(job.id);
                if (results.length >= limit) break;
              }

              if (jobs.length < batchSize) break;
              start += jobs.length;
            }

            if (scanned >= effectiveMaxScanned || results.length >= limit)
              break;
          }

          scanLimitReached = scanned >= effectiveMaxScanned;
          resultLimitReached = results.length >= limit;

          return {
            results,
            scanned,
            partial: scanLimitReached || resultLimitReached,
            scanLimitReached,
            resultLimitReached,
          };
        } catch (e) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: presentErrorMessage(e, internalCtx.privacy),
          });
        }
      },
    ),
  list: procedure
    .input(
      z.object({
        queueName: z.string(),
        cursor: z.number().min(0).optional().default(0),
        limit: z.number().min(1).max(100),
        status: z.enum(JOB_STATUSES),
        groupId: z.string().optional(),
        query: z.string().trim().min(1).max(200).optional(),
        searchInData: z.boolean().default(true),
        scanLimit: z.number().min(25).max(MAX_JOB_SCAN_LIMIT).default(5_000),
        sort: z.enum(["newest", "oldest"]).default("newest"),
      }),
    )
    .query(
      async ({
        input: {
          queueName,
          status,
          limit,
          cursor,
          groupId,
          query,
          searchInData,
          scanLimit,
          sort,
        },
        ctx,
      }) => {
        const internalCtx = await transformContext(ctx);
        const queueInCtx = findQueueInCtxOrFail({
          queues: internalCtx.queues,
          queueName,
        });

        if (!queueInCtx.adapter.supports.statuses.includes(status)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${queueInCtx.adapter.getType()} does not support the ${status} job status`,
          });
        }

        try {
          if (groupId || query || sort === "oldest") {
            const effectiveScanLimit = getEffectiveScanLimit(
              internalCtx,
              scanLimit,
            );
            const scan = await scanJobsForStatus({
              adapter: queueInCtx.adapter,
              groupId,
              maxScanned: effectiveScanLimit,
              privacy: internalCtx.privacy,
              query,
              searchInData,
              status,
            });
            const filteredJobs = scan.jobs
              .map(({ presented }) => presented)
              .sort((left, right) => {
                const difference =
                  left.createdAt.getTime() - right.createdAt.getTime();
                return sort === "oldest" ? difference : -difference;
              });

            const jobs = filteredJobs.slice(cursor, cursor + limit);
            const totalCount = filteredJobs.length;
            const hasNextPage = cursor + limit < totalCount;

            return {
              totalCount,
              numOfPages: Math.ceil(totalCount / limit),
              nextCursor: hasNextPage ? cursor + limit : undefined,
              jobs,
              searchMeta: {
                scanned: scan.scanned,
                capped: scan.scanLimitReached,
                scanLimit: effectiveScanLimit,
              },
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
            jobs: jobs.map((job) => presentJob(job, internalCtx.privacy)),
            searchMeta: undefined,
          };
        } catch (e) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: presentErrorMessage(e, internalCtx.privacy),
          });
        }
      },
    ),
});
