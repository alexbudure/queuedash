import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assertQueueActionAllowed } from "../access";
import {
  presentErrorMessage,
  presentJob,
  presentLogs,
  privacyRedactsGroupIdentity,
  privacyRedactsJobIdentity,
} from "../presentation";
import type {
  AdaptedJob,
  JobPageMeta,
  JobScanToken,
} from "../queue-adapters/base.adapter";
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

const JOB_SEARCH_BATCH_SIZE = 100;
const MAX_JOB_SCAN_LIMIT = 5_000;
const MAX_ADAPTER_PAGE_CURSOR = 5_000;
const BULK_ACTION_CONCURRENCY = 25;

const getJobsPage = async (
  adapter: {
    getJobs: (
      status: never,
      start: number,
      end: number,
      scanLimit?: number,
      scanToken?: JobScanToken,
    ) => Promise<unknown[]>;
    getJobPageMeta?: (jobs: AdaptedJob[]) => JobPageMeta | undefined;
    beginJobScan?: (
      status: never,
      scanLimit?: number,
    ) => JobScanToken | undefined;
    endJobScan?: (scanToken: JobScanToken) => void;
  },
  status: JobListStatus,
  start: number,
  end: number,
  scanLimit?: number,
  scanToken?: JobScanToken,
): Promise<AdaptedJob[]> => {
  const jobs = await adapter.getJobs(
    status as never,
    start,
    end,
    scanLimit,
    scanToken,
  );
  return jobs as AdaptedJob[];
};

const getEffectiveScanLimit = (
  ctx: InternalContext,
  requestedLimit: number,
): number => {
  const configuredLimit = Math.floor(
    ctx.search?.maxScanned ?? MAX_JOB_SCAN_LIMIT,
  );
  return Math.min(
    Math.floor(requestedLimit),
    Math.min(
      Math.max(
        Number.isFinite(configuredLimit) ? configuredLimit : MAX_JOB_SCAN_LIMIT,
        25,
      ),
      MAX_JOB_SCAN_LIMIT,
    ),
  );
};

const assertGroupFilterAllowed = (
  groupId: string | undefined,
  privacy: InternalContext["privacy"],
): void => {
  if (!groupId || !privacyRedactsGroupIdentity(privacy)) return;

  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Group filtering is disabled when group identifiers are redacted",
  });
};

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
  let slotsScanned = 0;
  let start = 0;
  let exhausted = false;
  let scanLimitReached = false;
  let adapterScanned = 0;
  const scanToken = adapter.beginJobScan?.(status as never, maxScanned);

  try {
    while (slotsScanned < maxScanned) {
      const batchSize = Math.min(
        JOB_SEARCH_BATCH_SIZE,
        maxScanned - slotsScanned,
      );
      const page = await getJobsPage(
        adapter,
        status,
        start,
        start + batchSize - 1,
        maxScanned,
        scanToken,
      );
      const pageMeta = adapter.getJobPageMeta?.(page);
      if (pageMeta?.capped) scanLimitReached = true;

      const pageScanned = pageMeta
        ? Math.max(0, pageMeta.scanned - adapterScanned)
        : page.length;
      slotsScanned += pageScanned;
      start += pageMeta?.cursorAdvance ?? batchSize;
      scanned += pageScanned;
      if (pageMeta) adapterScanned = Math.max(adapterScanned, pageMeta.scanned);
      if (page.length === 0) {
        exhausted = pageMeta?.exhausted ?? !pageMeta?.capped;
        if (exhausted || pageMeta?.capped || pageScanned === 0) break;
        continue;
      }

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
      if (pageMeta?.exhausted) exhausted = true;
      if (!pageMeta && page.length < batchSize) exhausted = true;
      if (exhausted) break;
      if (pageMeta?.capped) break;
    }

    scanLimitReached =
      scanLimitReached || (!exhausted && slotsScanned >= maxScanned);

    return { jobs, scanned, scanLimitReached };
  } finally {
    if (scanToken) adapter.endJobScan?.(scanToken);
  }
};

const scanJobsAcrossStatuses = async ({
  adapter,
  groupId,
  maxScanned,
  statuses,
}: {
  adapter: Parameters<typeof getJobsPage>[0];
  groupId: string;
  maxScanned: number;
  statuses: JobListStatus[];
}): Promise<{
  jobs: AdaptedJob[];
  scanned: number;
  scanLimitReached: boolean;
}> => {
  const jobs = new Map<string, AdaptedJob>();
  const statusScans = statuses.map((status) => ({
    adapterScanLimit: 0,
    adapterScanned: 0,
    exhausted: false,
    start: 0,
    status,
    scanToken: adapter.beginJobScan?.(status as never, maxScanned),
  }));
  let scanned = 0;
  let slotsScanned = 0;
  let scanLimitReached = false;

  try {
    while (slotsScanned < maxScanned) {
      const activeScans = statusScans.filter(({ exhausted }) => !exhausted);
      if (activeScans.length === 0) break;
      let madeProgress = false;

      for (let index = 0; index < activeScans.length; index += 1) {
        if (slotsScanned >= maxScanned) break;

        const scan = activeScans[index];
        const remainingBudget = maxScanned - slotsScanned;
        const statusesRemainingThisRound = activeScans.length - index;
        const fairShare = Math.max(
          1,
          Math.floor(remainingBudget / statusesRemainingThisRound),
        );
        const batchSize = Math.min(JOB_SEARCH_BATCH_SIZE, fairShare);
        scan.adapterScanLimit += batchSize;
        const page = await getJobsPage(
          adapter,
          scan.status,
          scan.start,
          scan.start + batchSize - 1,
          scan.adapterScanLimit,
          scan.scanToken,
        );
        const pageMeta = adapter.getJobPageMeta?.(page);
        const pageScanned = pageMeta
          ? Math.max(0, pageMeta.scanned - scan.adapterScanned)
          : page.length;
        slotsScanned += pageScanned;
        scan.start += pageMeta?.cursorAdvance ?? batchSize;
        scanned += pageScanned;
        if (pageMeta) {
          scan.adapterScanned = Math.max(scan.adapterScanned, pageMeta.scanned);
        }
        if (page.length === 0) {
          scan.exhausted = pageMeta?.exhausted ?? !pageMeta?.capped;
          madeProgress ||= pageScanned > 0;
          continue;
        }

        madeProgress = true;
        for (const job of page) {
          if (job.groupId === groupId) jobs.set(job.id, job);
        }
        if (!pageMeta && page.length < batchSize) scan.exhausted = true;
        if (pageMeta?.exhausted) scan.exhausted = true;
      }

      if (!madeProgress) break;
    }

    scanLimitReached =
      scanLimitReached ||
      (slotsScanned >= maxScanned &&
        statusScans.some(({ exhausted }) => !exhausted));

    return {
      jobs: Array.from(jobs.values()),
      scanned,
      scanLimitReached,
    };
  } finally {
    for (const { scanToken } of statusScans) {
      if (scanToken) adapter.endJobScan?.(scanToken);
    }
  }
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

      if (!queueInCtx.adapter.supports.discard) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support discarding jobs`,
        });
      }

      const job = await queueInCtx.adapter.getJob(jobId);
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

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
        groupId: z.string().min(1).optional(),
        query: z.string().trim().min(1).max(200).optional(),
        maxScanned: z
          .number()
          .int()
          .min(25)
          .max(MAX_JOB_SCAN_LIMIT)
          .default(5_000),
      }),
    )
    .mutation(
      async ({
        input: { queueName, status, groupId, query, maxScanned },
        ctx,
      }) => {
        const internalCtx = await transformContext(ctx);
        assertGroupFilterAllowed(groupId, internalCtx.privacy);
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
        groupId: z.string().min(1).optional(),
        query: z.string().trim().min(1).max(200).optional(),
        maxScanned: z
          .number()
          .int()
          .min(25)
          .max(MAX_JOB_SCAN_LIMIT)
          .default(5_000),
      }),
    )
    .mutation(
      async ({
        input: { queueName, status, groupId, query, maxScanned },
        ctx,
      }) => {
        const internalCtx = await transformContext(ctx);
        assertGroupFilterAllowed(groupId, internalCtx.privacy);
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
        groupId: z.string().min(1).optional(),
        query: z.string().trim().min(1).max(200).optional(),
        maxScanned: z
          .number()
          .int()
          .min(25)
          .max(MAX_JOB_SCAN_LIMIT)
          .default(5_000),
      }),
    )
    .mutation(
      async ({
        input: { queueName, status, groupId, query, maxScanned },
        ctx,
      }) => {
        const internalCtx = await transformContext(ctx);
        assertGroupFilterAllowed(groupId, internalCtx.privacy);
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
        groupId: z.string().min(1),
        maxScanned: z
          .number()
          .int()
          .min(25)
          .max(MAX_JOB_SCAN_LIMIT)
          .default(MAX_JOB_SCAN_LIMIT),
      }),
    )
    .mutation(async ({ input: { queueName, groupId, maxScanned }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertGroupFilterAllowed(groupId, internalCtx.privacy);
      assertQueueActionAllowed(internalCtx, queueName, "job.remove");
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      try {
        const scan = await scanJobsAcrossStatuses({
          adapter: queueInCtx.adapter,
          groupId,
          maxScanned: getEffectiveScanLimit(internalCtx, maxScanned),
          statuses: queueInCtx.adapter.supports.statuses.filter((status) =>
            JOB_STATUSES.includes(status as JobListStatus),
          ) as JobListStatus[],
        });
        let succeeded = 0;
        for (
          let index = 0;
          index < scan.jobs.length;
          index += BULK_ACTION_CONCURRENCY
        ) {
          const batch = scan.jobs.slice(index, index + BULK_ACTION_CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map((job) => queueInCtx.adapter.removeJob(job.id)),
          );
          succeeded += results.filter(
            (result) => result.status === "fulfilled",
          ).length;
        }

        return {
          total: scan.jobs.length,
          succeeded,
          failed: scan.jobs.length - succeeded,
          scanned: scan.scanned,
          partial: scan.scanLimitReached,
          scanLimitReached: scan.scanLimitReached,
        };
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
      if (privacyRedactsJobIdentity(internalCtx.privacy)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Job lookup is disabled when job identifiers are redacted",
        });
      }
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
      if (privacyRedactsJobIdentity(internalCtx.privacy)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Job logs are disabled when job identifiers are redacted",
        });
      }
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
        statuses: z
          .array(z.enum(JOB_STATUSES))
          .max(JOB_STATUSES.length)
          .optional(),
        limit: z.number().int().min(1).max(50).default(25),
        maxScanned: z
          .number()
          .int()
          .min(25)
          .max(MAX_JOB_SCAN_LIMIT)
          .default(500),
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
        const requestedStatuses = Array.from(
          new Set(statuses ?? JOB_STATUSES),
        ).filter((status) =>
          queueInCtx.adapter.supports.statuses.includes(status),
        );
        const results: Array<{
          job: AdaptedJob;
          status: JobListStatus | null;
        }> = [];
        const seen = new Set<string>();
        const statusScans = requestedStatuses.map((status) => ({
          adapterScanLimit: 0,
          adapterScanned: 0,
          exhausted: false,
          start: 0,
          status,
          scanToken: queueInCtx.adapter.beginJobScan(
            status as never,
            effectiveMaxScanned,
          ),
        }));
        let scanned = 0;
        let slotsScanned = 0;
        let scanLimitReached = false;
        let resultLimitReached = false;

        try {
          const exactJob = await queueInCtx.adapter.getJob(query);
          if (exactJob) {
            const exactStatus = await queueInCtx.adapter.getJobStatus(query);
            const normalizedExactStatus = JOB_STATUSES.includes(
              exactStatus as JobListStatus,
            )
              ? (exactStatus as JobListStatus)
              : null;
            if (
              (normalizedExactStatus &&
                requestedStatuses.includes(normalizedExactStatus)) ||
              (!normalizedExactStatus && statuses === undefined)
            ) {
              const presented = presentJob(exactJob, internalCtx.privacy);
              if (getSearchText(presented).includes(normalizedQuery)) {
                results.push({
                  job: presented,
                  status: normalizedExactStatus,
                });
                seen.add(exactJob.id);
              }
            }
          }

          while (slotsScanned < effectiveMaxScanned && results.length < limit) {
            const activeScans = statusScans.filter(
              ({ exhausted }) => !exhausted,
            );
            if (activeScans.length === 0) break;
            let madeProgress = false;
            const roundMatches = activeScans.map(
              () =>
                [] as Array<{
                  job: AdaptedJob;
                  rawId: string;
                  status: JobListStatus;
                }>,
            );
            const roundSeen = new Set(seen);

            for (let index = 0; index < activeScans.length; index += 1) {
              if (slotsScanned >= effectiveMaxScanned) break;

              const scan = activeScans[index];
              const remainingBudget = effectiveMaxScanned - slotsScanned;
              const statusesRemainingThisRound = activeScans.length - index;
              const fairShare = Math.max(
                1,
                Math.floor(remainingBudget / statusesRemainingThisRound),
              );
              const batchSize = Math.min(JOB_SEARCH_BATCH_SIZE, fairShare);
              scan.adapterScanLimit += batchSize;
              const jobs = await getJobsPage(
                queueInCtx.adapter,
                scan.status,
                scan.start,
                scan.start + batchSize - 1,
                scan.adapterScanLimit,
                scan.scanToken,
              );
              const pageMeta = queueInCtx.adapter.getJobPageMeta?.(jobs);
              const pageScanned = pageMeta
                ? Math.max(0, pageMeta.scanned - scan.adapterScanned)
                : jobs.length;
              slotsScanned += pageScanned;
              scan.start += pageMeta?.cursorAdvance ?? batchSize;
              scanned += pageScanned;
              if (pageMeta) {
                scan.adapterScanned = Math.max(
                  scan.adapterScanned,
                  pageMeta.scanned,
                );
              }
              if (jobs.length === 0) {
                scan.exhausted = pageMeta?.exhausted ?? !pageMeta?.capped;
                madeProgress ||= pageScanned > 0;
                continue;
              }

              madeProgress = true;

              for (const rawJob of jobs) {
                if (roundSeen.has(rawJob.id)) continue;

                const job = presentJob(rawJob, internalCtx.privacy);
                if (!getSearchText(job).includes(normalizedQuery)) continue;

                roundMatches[index]?.push({
                  job,
                  rawId: rawJob.id,
                  status: scan.status,
                });
                roundSeen.add(rawJob.id);
              }
              if (!pageMeta && jobs.length < batchSize) {
                scan.exhausted = true;
              }
              if (pageMeta?.exhausted) scan.exhausted = true;
            }

            for (let matchIndex = 0; results.length < limit; matchIndex += 1) {
              let addedMatch = false;
              for (const matches of roundMatches) {
                const match = matches[matchIndex];
                if (!match) continue;
                results.push({ job: match.job, status: match.status });
                seen.add(match.rawId);
                addedMatch = true;
                if (results.length >= limit) break;
              }
              if (!addedMatch) break;
            }

            if (!madeProgress) break;
          }

          scanLimitReached =
            scanLimitReached ||
            (slotsScanned >= effectiveMaxScanned &&
              statusScans.some(({ exhausted }) => !exhausted));
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
        } finally {
          for (const { scanToken } of statusScans) {
            if (scanToken) queueInCtx.adapter.endJobScan(scanToken);
          }
        }
      },
    ),
  list: procedure
    .input(
      z.object({
        queueName: z.string(),
        cursor: z.number().int().min(0).optional().default(0),
        limit: z.number().int().min(1).max(100),
        status: z.enum(JOB_STATUSES),
        groupId: z.string().min(1).optional(),
        query: z.string().trim().min(1).max(200).optional(),
        searchInData: z.boolean().default(true),
        scanLimit: z
          .number()
          .int()
          .min(25)
          .max(MAX_JOB_SCAN_LIMIT)
          .default(5_000),
        sort: z.enum(["queue", "newest", "oldest"]).default("queue"),
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
        assertGroupFilterAllowed(groupId, internalCtx.privacy);

        const effectiveScanLimit = getEffectiveScanLimit(
          internalCtx,
          scanLimit,
        );
        const adapterType = queueInCtx.adapter.getType();
        const boundedPageLabel =
          adapterType === "groupmq" && status === "waiting"
            ? "GroupMQ waiting-job"
            : adapterType === "bee" &&
                (status === "completed" || status === "failed")
              ? "Bee-Queue completed/failed"
              : undefined;
        const usesBoundedScan = Boolean(
          groupId || query || sort === "newest" || sort === "oldest",
        );
        const pageLimit = usesBoundedScan
          ? effectiveScanLimit
          : boundedPageLabel
            ? MAX_ADAPTER_PAGE_CURSOR
            : undefined;
        if (pageLimit !== undefined && cursor + limit > pageLimit) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${boundedPageLabel ?? "Job"} pagination is limited to the first ${pageLimit.toLocaleString()} jobs`,
          });
        }

        try {
          if (usesBoundedScan) {
            const scan = await scanJobsForStatus({
              adapter: queueInCtx.adapter,
              groupId,
              maxScanned: effectiveScanLimit,
              privacy: internalCtx.privacy,
              query,
              searchInData,
              status,
            });
            const filteredJobs = scan.jobs.map(({ presented }) => presented);
            if (sort !== "queue") {
              filteredJobs.sort((left, right) => {
                const difference =
                  left.createdAt.getTime() - right.createdAt.getTime();
                return sort === "oldest" ? difference : -difference;
              });
            }
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
          const adapterPageMeta = queueInCtx.adapter.getJobPageMeta?.(jobs);
          const counts = await queueInCtx.adapter.getJobCounts();
          const uncappedTotalCount = counts[status] || 0;
          const totalCount = boundedPageLabel
            ? Math.min(uncappedTotalCount, MAX_ADAPTER_PAGE_CURSOR)
            : uncappedTotalCount;
          const hasNextPage = cursor + limit < totalCount;
          const totalCapReached =
            boundedPageLabel && uncappedTotalCount > MAX_ADAPTER_PAGE_CURSOR;
          const searchMeta = totalCapReached
            ? {
                scanned: Math.max(
                  adapterPageMeta?.scanned ?? 0,
                  MAX_ADAPTER_PAGE_CURSOR,
                ),
                capped: true,
                scanLimit: MAX_ADAPTER_PAGE_CURSOR,
              }
            : adapterPageMeta;

          return {
            totalCount,
            numOfPages: Math.ceil(totalCount / limit),
            nextCursor: hasNextPage ? cursor + limit : undefined,
            jobs: jobs.map((job) => presentJob(job, internalCtx.privacy)),
            searchMeta,
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
