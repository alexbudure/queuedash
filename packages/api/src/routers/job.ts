import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assertQueueActionAllowed } from "../access";
import {
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

const toJobListStatus = (status: string | null): JobListStatus | null =>
  JOB_STATUSES.includes(status as JobListStatus)
    ? (status as JobListStatus)
    : null;

const JOB_SEARCH_BATCH_SIZE = 100;
const MAX_JOB_SCAN_LIMIT = 5_000;
const MAX_ADAPTER_PAGE_CURSOR = 5_000;
const BULK_ACTION_CONCURRENCY = 25;
// A selection of rows, not a filter: acting on everything that matches is the
// by-filter actions' job, and those stay within the scan limit.
const MAX_BULK_JOB_IDS = 1_000;

// A filtered, grouped or sorted list is built by a bounded scan. Scanning again
// for every "load more" read up to 5,000 jobs to show 30, and on a busy queue
// the rescanned order had shifted, so the next page repeated rows the last one
// showed and skipped others. Page 1 always scans and keeps the order it found:
// ids only, never jobs, so at most MAX_LIST_SNAPSHOTS lists of at most
// MAX_JOB_SCAN_LIMIT ids each stay in memory. Later pages read just their own
// jobs from it.
const LIST_SNAPSHOT_TTL_MS = 60_000;
const MAX_LIST_SNAPSHOTS = 32;

type ListSnapshot = {
  createdAt: number;
  ids: string[];
  scanned: number;
  scanLimitReached: boolean;
};

// Oldest first: every store re-inserts its entry.
const listSnapshots = new Map<string, ListSnapshot>();
// Each dashboard context builds its own adapters, so the adapter also pins the
// privacy policy a query was matched under.
const listSnapshotOwners = new WeakMap<object, number>();
let nextListSnapshotOwner = 0;

const getListSnapshotKey = (
  adapter: object,
  list: {
    groupId?: string;
    query?: string;
    scanLimit: number;
    searchInData: boolean;
    sort: string;
    status: JobListStatus;
  },
): string => {
  let owner = listSnapshotOwners.get(adapter);
  if (owner === undefined) {
    owner = nextListSnapshotOwner;
    nextListSnapshotOwner += 1;
    listSnapshotOwners.set(adapter, owner);
  }
  return JSON.stringify([
    owner,
    list.status,
    list.sort,
    list.query?.toLocaleLowerCase() ?? null,
    list.groupId ?? null,
    list.scanLimit,
    list.searchInData,
  ]);
};

const readListSnapshot = (key: string): ListSnapshot | undefined => {
  const snapshot = listSnapshots.get(key);
  if (!snapshot) return undefined;
  if (Date.now() - snapshot.createdAt < LIST_SNAPSHOT_TTL_MS) return snapshot;
  listSnapshots.delete(key);
  return undefined;
};

const storeListSnapshot = (
  key: string,
  snapshot: Omit<ListSnapshot, "createdAt">,
): void => {
  const createdAt = Date.now();
  listSnapshots.delete(key);
  for (const [storedKey, stored] of listSnapshots) {
    if (
      listSnapshots.size < MAX_LIST_SNAPSHOTS &&
      createdAt - stored.createdAt < LIST_SNAPSHOT_TTL_MS
    ) {
      break;
    }
    listSnapshots.delete(storedKey);
  }
  listSnapshots.set(key, { ...snapshot, createdAt });
};

// At most BULK_ACTION_CONCURRENCY jobs at a time, each settled on its own: a
// missing or failing job is counted rather than failing the request while the
// rest carry on.
const runBulkJobActions = async (
  jobIds: readonly string[],
  action: (jobId: string) => Promise<void>,
): Promise<{ succeeded: number; failed: number }> => {
  let succeeded = 0;
  for (let index = 0; index < jobIds.length; index += BULK_ACTION_CONCURRENCY) {
    const batch = jobIds.slice(index, index + BULK_ACTION_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((jobId) => action(jobId)),
    );
    succeeded += results.filter(
      (result) => result.status === "fulfilled",
    ).length;
  }
  return { succeeded, failed: jobIds.length - succeeded };
};

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
  // Only when a text query had to be matched against what the viewer sees.
  // Presenting (redaction included) every scanned job just to show 30 of
  // them, or to act on raw ids, is wasted work.
  presented?: AdaptedJob;
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
  const seen = new Set<string>();
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
        // Pages are read by offset from a live list: jobs added ahead of the
        // scan push rows it already read into the next page. Counted twice, a
        // list showed them twice and a bulk action failed the second time.
        if (seen.has(raw.id)) continue;
        seen.add(raw.id);
        if (groupId && raw.groupId !== groupId) continue;
        if (!normalizedQuery) {
          jobs.push({ raw });
          continue;
        }
        const presented = presentJob(raw, privacy);
        if (!getSearchText(presented, searchInData).includes(normalizedQuery)) {
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
    truncated: false,
    scanToken: adapter.beginJobScan?.(status as never, maxScanned),
  }));
  let scanned = 0;
  let slotsScanned = 0;
  let scanLimitReached = false;

  try {
    while (slotsScanned < maxScanned) {
      const activeScans = statusScans.filter(
        ({ exhausted, truncated }) => !exhausted && !truncated,
      );
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
        // The adapter saw only part of this status, as GroupMQ does past its
        // first 5,000 groups. What it returned counts, but no larger limit
        // reaches the rest, so the scan stops there and must not report itself
        // complete. A page that is merely capped reached only the limit this
        // round raised the status to, and the next round reads on.
        if (pageMeta?.truncated) {
          scan.truncated = true;
          scanLimitReached = true;
        }
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
  const { succeeded, failed } = await runBulkJobActions(
    scan.jobs.map(({ raw }) => raw.id),
    action,
  );

  return {
    scanned: scan.scanned,
    matched: scan.jobs.length,
    succeeded,
    failed,
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

      // A missing job reaches the error middleware as the adapter's
      // JobNotFoundError, which it answers with NOT_FOUND.
      await queueInCtx.adapter.retryJob(jobId);

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

      await queueInCtx.adapter.discardJob(jobId);

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

      await queueInCtx.adapter.addJob(job.data);

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
        return runFilteredJobAction({
          action: (jobId) => queueInCtx.adapter.promoteJob(jobId),
          adapter: queueInCtx.adapter,
          groupId,
          maxScanned: getEffectiveScanLimit(internalCtx, maxScanned),
          privacy: internalCtx.privacy,
          query,
          status,
        });
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

      await queueInCtx.adapter.removeJob(jobId);

      return presentJob(job, internalCtx.privacy);
    }),
  bulkRemove: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobIds: z.array(z.string()).max(MAX_BULK_JOB_IDS),
      }),
    )
    .mutation(async ({ input: { jobIds, queueName }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "job.remove");
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      // Adapters reject an id that is no job with JobNotFoundError, so a
      // missing job counts as failed. A job listed twice is one job: removing
      // it again would only fail, or succeed twice in a race.
      return runBulkJobActions(Array.from(new Set(jobIds)), (jobId) =>
        queueInCtx.adapter.removeJob(jobId),
      );
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

        return runFilteredJobAction({
          action: (jobId) => queueInCtx.adapter.removeJob(jobId),
          adapter: queueInCtx.adapter,
          groupId,
          maxScanned: getEffectiveScanLimit(internalCtx, maxScanned),
          privacy: internalCtx.privacy,
          query,
          status,
        });
      },
    ),
  bulkRetry: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobIds: z.array(z.string()).max(MAX_BULK_JOB_IDS),
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

      return runBulkJobActions(Array.from(new Set(jobIds)), (jobId) =>
        queueInCtx.adapter.retryJob(jobId),
      );
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

      const scan = await scanJobsAcrossStatuses({
        adapter: queueInCtx.adapter,
        groupId,
        maxScanned: getEffectiveScanLimit(internalCtx, maxScanned),
        statuses: queueInCtx.adapter.supports.statuses.filter((status) =>
          JOB_STATUSES.includes(status as JobListStatus),
        ) as JobListStatus[],
      });
      const { succeeded, failed } = await runBulkJobActions(
        scan.jobs.map((job) => job.id),
        (jobId) => queueInCtx.adapter.removeJob(jobId),
      );

      return {
        total: scan.jobs.length,
        succeeded,
        failed,
        scanned: scan.scanned,
        partial: scan.scanLimitReached,
        scanLimitReached: scan.scanLimitReached,
      };
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

      // A row is only as fresh as the list it came from, so the job carries
      // its live state: a delayed job that has since run must not keep
      // offering Promote. Null when the adapter can't tell.
      const [job, status] = await Promise.all([
        queueInCtx.adapter.getJob(jobId),
        queueInCtx.adapter.getJobStatus(jobId),
      ]);
      if (!job) return null;
      return {
        ...presentJob(job, internalCtx.privacy),
        status: toJobListStatus(status),
      };
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
          truncated: false,
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
            const normalizedExactStatus = toJobListStatus(
              await queueInCtx.adapter.getJobStatus(query),
            );
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
              ({ exhausted, truncated }) => !exhausted && !truncated,
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
              // As in scanJobsAcrossStatuses: no larger limit reaches the rest
              // of a truncated status, so this search can't claim it found
              // everything. A merely capped page is read on next round.
              if (pageMeta?.truncated) {
                scan.truncated = true;
                scanLimitReached = true;
              }
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
        // Every cursor this list hands out has to be one it accepts. The last
        // page stops at the limit, shorter than asked if need be, where it
        // used to be refused: 30 per page under a 1,000-job limit failed at
        // cursor 990, and a 25-job limit failed on page 1.
        if (pageLimit !== undefined && cursor >= pageLimit) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${boundedPageLabel ?? "Job"} pagination is limited to the first ${pageLimit.toLocaleString()} jobs`,
          });
        }
        const pageEnd =
          pageLimit === undefined
            ? cursor + limit
            : Math.min(cursor + limit, pageLimit);
        const getNextCursor = (totalCount: number): number | undefined =>
          pageEnd < Math.min(totalCount, pageLimit ?? totalCount)
            ? pageEnd
            : undefined;

        if (usesBoundedScan) {
          const snapshotKey = getListSnapshotKey(queueInCtx.adapter, {
            groupId,
            query,
            scanLimit: effectiveScanLimit,
            searchInData,
            sort,
            status,
          });
          // Page 1 always scans, so a polled first page stays live, and its
          // order replaces the one later pages read from.
          const snapshot =
            cursor > 0 ? readListSnapshot(snapshotKey) : undefined;
          if (snapshot) {
            const jobs = await Promise.all(
              snapshot.ids
                .slice(cursor, pageEnd)
                .map((jobId) => queueInCtx.adapter.getJob(jobId)),
            );
            const totalCount = snapshot.ids.length;

            return {
              totalCount,
              numOfPages: Math.ceil(totalCount / limit),
              nextCursor: getNextCursor(totalCount),
              // A job removed since page 1 drops out of its page.
              jobs: jobs.flatMap((job) =>
                job ? [presentJob(job, internalCtx.privacy)] : [],
              ),
              searchMeta: {
                scanned: snapshot.scanned,
                capped: snapshot.scanLimitReached,
                scanLimit: effectiveScanLimit,
              },
            };
          }

          const scan = await scanJobsForStatus({
            adapter: queueInCtx.adapter,
            groupId,
            maxScanned: effectiveScanLimit,
            privacy: internalCtx.privacy,
            query,
            searchInData,
            status,
          });
          const matches = scan.jobs;
          if (sort !== "queue") {
            matches.sort((left, right) => {
              const difference =
                left.raw.createdAt.getTime() - right.raw.createdAt.getTime();
              return sort === "oldest" ? difference : -difference;
            });
          }
          storeListSnapshot(snapshotKey, {
            ids: matches.map(({ raw }) => raw.id),
            scanned: scan.scanned,
            scanLimitReached: scan.scanLimitReached,
          });
          const totalCount = matches.length;

          return {
            totalCount,
            numOfPages: Math.ceil(totalCount / limit),
            nextCursor: getNextCursor(totalCount),
            jobs: matches
              .slice(cursor, pageEnd)
              .map(
                ({ presented, raw }) =>
                  presented ?? presentJob(raw, internalCtx.privacy),
              ),
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
          pageEnd - 1,
        );
        const adapterPageMeta = queueInCtx.adapter.getJobPageMeta?.(jobs);
        const counts = await queueInCtx.adapter.getJobCounts();
        const uncappedTotalCount = counts[status] || 0;
        const totalCount = boundedPageLabel
          ? Math.min(uncappedTotalCount, MAX_ADAPTER_PAGE_CURSOR)
          : uncappedTotalCount;
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
          nextCursor: getNextCursor(totalCount),
          jobs: jobs.map((job) => presentJob(job, internalCtx.privacy)),
          searchMeta,
        };
      },
    ),
});
