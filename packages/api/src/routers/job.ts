import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assertQueueActionAllowed } from "../access";
import { type FailureSignature, getFailureSignature } from "../failures";
import {
  presentJob,
  presentLogs,
  privacyRedactsGroupIdentity,
  privacyRedactsJobIdentity,
  resolvePrivacyExposure,
} from "../presentation";
import type {
  AdaptedJob,
  FinishedRange,
  JobPageMeta,
  JobScanToken,
  JobTimeRange,
} from "../queue-adapters/base.adapter";
import { percentile, type RunSample, summarizeRunTimes } from "../run-times";
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
// An error group's fingerprint, as getFailureSignature makes it.
const ERROR_FINGERPRINT = z.string().regex(/^[0-9a-f]{16}$/u);
// A date range, epoch milliseconds, both ends inclusive and optional. Either
// end can instead be an offset from the moment the request runs, negative for
// the past, which a polled "last hour" needs to stay the last hour. An offset
// wins over a moment for the same end.
const MAX_TIME_OFFSET_MS = 366 * 24 * 60 * 60_000;
const TIME_BOUND = z.number().int().min(0).optional();
const TIME_OFFSET = z
  .number()
  .int()
  .min(-MAX_TIME_OFFSET_MS)
  .max(MAX_TIME_OFFSET_MS)
  .optional();
const TIME_RANGE_INPUT = {
  from: TIME_BOUND,
  to: TIME_BOUND,
  fromOffset: TIME_OFFSET,
  toOffset: TIME_OFFSET,
};
type TimeRangeInput = {
  from?: number;
  to?: number;
  fromOffset?: number;
  toOffset?: number;
};

const resolveTimeRange = (
  { from, to, fromOffset, toOffset }: TimeRangeInput,
  now = Date.now(),
): JobTimeRange => ({
  from: fromOffset === undefined ? from : Math.max(0, now + fromOffset),
  to: toOffset === undefined ? to : Math.max(0, now + toOffset),
});
// A job's name as it was added (see AdaptedJob.rawName).
const JOB_NAME = z.string().min(1).max(200).optional();

// The moment a date range filters a job on, which depends on its status:
// when it finished, when it is due, or when it was added.
const getJobTime = (
  job: AdaptedJob,
  status: JobListStatus,
  runAt?: Date | null,
): number => {
  if (status === "completed" || status === "failed") {
    return (job.finishedAt ?? job.processedAt ?? job.createdAt).getTime();
  }
  if (status === "delayed") {
    return runAt
      ? runAt.getTime()
      : job.createdAt.getTime() + (Number(job.opts.delay) || 0);
  }
  return job.createdAt.getTime();
};

const isInTimeRange = (time: number, { from, to }: JobTimeRange): boolean =>
  (from === undefined || time >= from) && (to === undefined || time <= to);

const hasTimeRange = (range: JobTimeRange): boolean =>
  range.from !== undefined || range.to !== undefined;

// Where a range of finished jobs sits in the status's list, when the adapter
// keeps them sorted by finish time. Null means scan the status instead.
const getFinishedWindow = async (
  adapter: {
    getFinishedRange?: (
      status: "completed" | "failed",
      range: JobTimeRange,
    ) => Promise<FinishedRange | null>;
  },
  status: JobListStatus,
  range: JobTimeRange,
): Promise<FinishedRange | null> =>
  hasTimeRange(range) &&
  (status === "completed" || status === "failed") &&
  adapter.getFinishedRange
    ? adapter.getFinishedRange(status, range)
    : null;

// A delayed job's due time lives where the library schedules it, which a
// moved job changes and its added time plus delay does not.
const withRunAts = async (
  adapter: {
    getRunAts?: (jobIds: readonly string[]) => Promise<Map<string, Date>>;
  },
  status: JobListStatus | null,
  jobs: AdaptedJob[],
): Promise<AdaptedJob[]> => {
  if (status !== "delayed" || !adapter.getRunAts || jobs.length === 0) {
    return jobs;
  }
  const runAts = await adapter.getRunAts(jobs.map((job) => job.id));
  return jobs.map((job) => ({ ...job, runAt: runAts.get(job.id) ?? null }));
};

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

const getSnapshotOwner = (adapter: object): number => {
  let owner = listSnapshotOwners.get(adapter);
  if (owner === undefined) {
    owner = nextListSnapshotOwner;
    nextListSnapshotOwner += 1;
    listSnapshotOwners.set(adapter, owner);
  }
  return owner;
};

const getListSnapshotKey = (
  adapter: object,
  list: {
    errorFingerprint?: string;
    groupId?: string;
    jobName?: string;
    query?: string;
    range: TimeRangeInput;
    scanLimit: number;
    searchInData: boolean;
    sort: string;
    status: JobListStatus;
  },
): string =>
  JSON.stringify([
    getSnapshotOwner(adapter),
    list.status,
    list.sort,
    list.query?.toLocaleLowerCase() ?? null,
    list.groupId ?? null,
    list.scanLimit,
    list.searchInData,
    list.errorFingerprint ?? null,
    list.jobName ?? null,
    list.range.from ?? null,
    list.range.to ?? null,
    list.range.fromOffset ?? null,
    list.range.toOffset ?? null,
  ]);

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

const HOUR_MS = 3_600_000;
const ERROR_GROUP_RANGES_MS = {
  "1h": HOUR_MS,
  "24h": 24 * HOUR_MS,
  "7d": 7 * 24 * HOUR_MS,
  all: Number.POSITIVE_INFINITY,
} as const;

type ScannedFailure = { at: number; signature: FailureSignature };
type FailureScan = {
  createdAt: number;
  failures: ScannedFailure[];
  scanned: number;
  scanLimitReached: boolean;
};

// The Errors tab polls, and grouping reads up to 5,000 failed jobs. Its
// result is kept briefly per queue and scan limit, and every range is cut
// from the same scan.
const FAILURE_SCAN_TTL_MS = 10_000;
const MAX_FAILURE_SCANS = 16;
const failureScans = new Map<string, FailureScan>();

// Run times come from the newest completed jobs the same way: the Health
// strip polls, so one scan serves every range for a few seconds.
type RunTimeScan = {
  createdAt: number;
  runs: RunSample[];
  scanned: number;
  scanLimitReached: boolean;
};
const RUN_TIME_SCAN_TTL_MS = 10_000;
const MAX_RUN_TIME_SCANS = 16;
const MAX_RUN_TIME_SAMPLE = 2_000;
const RUN_TIME_BUCKETS = 20;
const MAX_RUN_TIME_WINDOW_MINUTES = 7 * 24 * 60;
const runTimeScans = new Map<string, RunTimeScan>();

// Job types read the newest completed and failed jobs the same way, keeping
// only what the table needs of each.
type JobTypeSample = {
  name: string;
  at: number;
  failed: boolean;
  // How long a completed job ran, when it recorded both ends.
  ms: number | null;
};
type JobTypeScan = {
  createdAt: number;
  samples: JobTypeSample[];
  scanned: number;
  scanLimitReached: boolean;
};
const jobTypeScans = new Map<string, JobTypeScan>();

// Find searches every queue at once, a few at a time.
const FIND_CONCURRENCY = 4;
// No queue gets less than this share of the scan limit, however many there are.
const MIN_FIND_SCAN_PER_QUEUE = 100;
// BullMQ's highest priority number (2^21); 0 means no priority.
const MAX_JOB_PRIORITY = 2_097_152;
// Statuses whose jobs haven't started, which a priority still orders.
const PRIORITIZABLE_STATUSES: readonly JobListStatus[] = [
  "waiting",
  "prioritized",
  "delayed",
  "paused",
  "waiting-children",
];

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
    getRunAts?: (jobIds: readonly string[]) => Promise<Map<string, Date>>;
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

// The signature of a job's failure as the viewer may see it. Only the reason
// and traces are presented: redacting a job's data to read its error is work
// the answer never depends on.
const getPresentedFailureSignature = (
  job: AdaptedJob,
  privacy: InternalContext["privacy"],
  presented?: AdaptedJob,
): FailureSignature | null =>
  getFailureSignature(
    presented ??
      presentJob(
        { ...job, data: {}, opts: {}, returnValue: undefined },
        privacy,
      ),
  );

type QueueInContext = ReturnType<typeof findQueueInCtxOrFail>;

type FilteredJob = {
  // Only when a text query had to be matched against what the viewer sees.
  // Presenting (redaction included) every scanned job just to show 30 of
  // them, or to act on raw ids, is wasted work.
  presented?: AdaptedJob;
  raw: AdaptedJob;
};

const scanJobsForStatus = async ({
  adapter,
  errorFingerprint,
  groupId,
  jobName,
  maxScanned,
  privacy,
  query,
  range = {},
  searchInData = true,
  status,
  window,
}: {
  adapter: Parameters<typeof getJobsPage>[0];
  // Only jobs whose latest failure has this signature (see failures.ts).
  errorFingerprint?: string;
  groupId?: string;
  // Only jobs added under this name (rawName), as the Job types tab lists.
  jobName?: string;
  maxScanned: number;
  privacy: InternalContext["privacy"];
  query?: string;
  // Only jobs whose time for this status (see getJobTime) is in the range.
  range?: JobTimeRange;
  searchInData?: boolean;
  status: JobListStatus;
  // Where the range sits in the list, when the adapter knows: the scan reads
  // just those jobs, so the limit covers the range rather than the status.
  window?: FinishedRange | null;
}): Promise<{
  jobs: FilteredJob[];
  scanned: number;
  scanLimitReached: boolean;
}> => {
  const normalizedQuery = query?.trim().toLocaleLowerCase();
  const filtersByTime = hasTimeRange(range);
  const jobs: FilteredJob[] = [];
  const seen = new Set<string>();
  // A known window ends the scan where the range ends.
  const scanBudget = window ? Math.min(maxScanned, window.count) : maxScanned;
  let scanned = 0;
  let slotsScanned = 0;
  let start = window?.offset ?? 0;
  let exhausted = false;
  let scanLimitReached = false;
  // Adapters report how far into the list their pages reach, so a scan that
  // starts partway in counts from there.
  let adapterScanned = start;
  const scanToken = adapter.beginJobScan?.(status as never, maxScanned);

  try {
    while (slotsScanned < scanBudget) {
      const batchSize = Math.min(
        JOB_SEARCH_BATCH_SIZE,
        scanBudget - slotsScanned,
      );
      const page = await getJobsPage(
        adapter,
        status,
        start,
        start + batchSize - 1,
        maxScanned,
        scanToken,
      );
      const runAts =
        filtersByTime && status === "delayed" && adapter.getRunAts
          ? await adapter.getRunAts(page.map((job) => job.id))
          : undefined;
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
        if (jobName && (raw.rawName ?? raw.name) !== jobName) continue;
        if (
          filtersByTime &&
          !isInTimeRange(getJobTime(raw, status, runAts?.get(raw.id)), range)
        ) {
          continue;
        }
        if (!normalizedQuery && !errorFingerprint) {
          jobs.push({ raw });
          continue;
        }
        // Both filters match what the viewer can see, never the raw job: a
        // redacted secret must not be findable by guessing it.
        const presented = normalizedQuery
          ? presentJob(raw, privacy)
          : undefined;
        if (
          presented &&
          normalizedQuery &&
          !getSearchText(presented, searchInData).includes(normalizedQuery)
        ) {
          continue;
        }
        if (
          errorFingerprint &&
          getPresentedFailureSignature(raw, privacy, presented)?.fingerprint !==
            errorFingerprint
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

    // A window read to its end saw the whole range, limit or not.
    const sawWholeWindow =
      window !== undefined && window !== null
        ? window.count <= maxScanned
        : false;
    scanLimitReached =
      scanLimitReached ||
      (!exhausted && !sawWholeWindow && slotsScanned >= scanBudget);

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
  errorFingerprint,
  groupId,
  jobName,
  maxScanned,
  privacy,
  query,
  range = {},
  status,
}: {
  action: (jobId: string) => Promise<void>;
  adapter: Parameters<typeof getJobsPage>[0] &
    Parameters<typeof getFinishedWindow>[0];
  errorFingerprint?: string;
  groupId?: string;
  jobName?: string;
  maxScanned: number;
  privacy: InternalContext["privacy"];
  query?: string;
  range?: JobTimeRange;
  status: JobListStatus;
}) => {
  const scan = await scanJobsForStatus({
    adapter,
    errorFingerprint,
    groupId,
    jobName,
    maxScanned,
    privacy,
    query,
    range,
    status,
    window: await getFinishedWindow(adapter, status, range),
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

// Jobs in one queue whose id, name, group, error or visible data contain the
// query, across the given statuses, fairly: each status gets a share of the
// scan limit every round, so one long status can't starve the others.
const searchQueueJobs = async ({
  adapter,
  maxScanned,
  privacy,
  query,
  statuses,
  limit,
}: {
  adapter: QueueInContext["adapter"];
  maxScanned: number;
  privacy: InternalContext["privacy"];
  query: string;
  statuses: readonly JobListStatus[] | undefined;
  limit: number;
}): Promise<{
  results: Array<{ job: AdaptedJob; status: JobListStatus | null }>;
  scanned: number;
  partial: boolean;
  scanLimitReached: boolean;
  resultLimitReached: boolean;
}> => {
  const normalizedQuery = query.toLocaleLowerCase();
  const requestedStatuses = Array.from(
    new Set(statuses ?? JOB_STATUSES),
  ).filter((status) => adapter.supports.statuses.includes(status));
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
    scanToken: adapter.beginJobScan(status as never, maxScanned),
  }));
  let scanned = 0;
  let slotsScanned = 0;
  let scanLimitReached = false;
  let resultLimitReached = false;

  try {
    const exactJob = await adapter.getJob(query);
    if (exactJob) {
      const normalizedExactStatus = toJobListStatus(
        await adapter.getJobStatus(query),
      );
      if (
        (normalizedExactStatus &&
          requestedStatuses.includes(normalizedExactStatus)) ||
        (!normalizedExactStatus && statuses === undefined)
      ) {
        const presented = presentJob(exactJob, privacy);
        if (getSearchText(presented).includes(normalizedQuery)) {
          results.push({
            job: presented,
            status: normalizedExactStatus,
          });
          seen.add(exactJob.id);
        }
      }
    }

    while (slotsScanned < maxScanned && results.length < limit) {
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
        const jobs = await getJobsPage(
          adapter,
          scan.status,
          scan.start,
          scan.start + batchSize - 1,
          scan.adapterScanLimit,
          scan.scanToken,
        );
        const pageMeta = adapter.getJobPageMeta?.(jobs);
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
          scan.adapterScanned = Math.max(scan.adapterScanned, pageMeta.scanned);
        }
        if (jobs.length === 0) {
          scan.exhausted = pageMeta?.exhausted ?? !pageMeta?.capped;
          madeProgress ||= pageScanned > 0;
          continue;
        }

        madeProgress = true;

        for (const rawJob of jobs) {
          if (roundSeen.has(rawJob.id)) continue;

          const job = presentJob(rawJob, privacy);
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
      (slotsScanned >= maxScanned &&
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
      if (scanToken) adapter.endJobScan(scanToken);
    }
  }
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

      // The adapter re-adds the job under its own name and settings. Adding
      // just its data named every rerun "Manual add", which a worker that
      // dispatches on the name could not process.
      const rerun = await queueInCtx.adapter.rerunJob(jobId);

      return presentJob(rerun, internalCtx.privacy);
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
        name: JOB_NAME,
        ...TIME_RANGE_INPUT,
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
        input: {
          queueName,
          status,
          groupId,
          query,
          name,
          from,
          to,
          fromOffset,
          toOffset,
          maxScanned,
        },
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
          jobName: name,
          maxScanned: getEffectiveScanLimit(internalCtx, maxScanned),
          privacy: internalCtx.privacy,
          query,
          range: resolveTimeRange({ from, to, fromOffset, toOffset }),
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
        name: JOB_NAME,
        ...TIME_RANGE_INPUT,
        error: ERROR_FINGERPRINT.optional(),
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
        input: {
          queueName,
          status,
          groupId,
          query,
          error,
          name,
          from,
          to,
          fromOffset,
          toOffset,
          maxScanned,
        },
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
          errorFingerprint: error,
          groupId,
          jobName: name,
          maxScanned: getEffectiveScanLimit(internalCtx, maxScanned),
          privacy: internalCtx.privacy,
          query,
          range: resolveTimeRange({ from, to, fromOffset, toOffset }),
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
        name: JOB_NAME,
        ...TIME_RANGE_INPUT,
        error: ERROR_FINGERPRINT.optional(),
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
        input: {
          queueName,
          status,
          groupId,
          query,
          error,
          name,
          from,
          to,
          fromOffset,
          toOffset,
          maxScanned,
        },
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
          errorFingerprint: error,
          groupId,
          jobName: name,
          maxScanned: getEffectiveScanLimit(internalCtx, maxScanned),
          privacy: internalCtx.privacy,
          query,
          range: resolveTimeRange({ from, to, fromOffset, toOffset }),
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
      const listStatus = toJobListStatus(status);
      const [current = job] = await withRunAts(queueInCtx.adapter, listStatus, [
        job,
      ]);
      const presented = presentJob(current, internalCtx.privacy);
      return {
        ...presented,
        status: listStatus,
        // The error group this failure falls in, as the Errors tab keys it, so
        // the panel can tell how many other jobs failed the same way.
        errorFingerprint:
          getPresentedFailureSignature(job, internalCtx.privacy)?.fingerprint ??
          null,
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
        const queueInCtx = findQueueInCtxOrFail({
          queues: internalCtx.queues,
          queueName,
        });
        return searchQueueJobs({
          adapter: queueInCtx.adapter,
          maxScanned: getEffectiveScanLimit(internalCtx, maxScanned),
          privacy: internalCtx.privacy,
          query,
          statuses,
          limit,
        });
      },
    ),
  // Saves new data on the job itself, so it stays the same job: a failed
  // child retried this way is the one its flow's parent is waiting on.
  updateData: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
        data: z.object({}).passthrough(),
        // Retry the job once its data is saved.
        retry: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input: { queueName, jobId, data, retry }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "job.update");
      if (retry) assertQueueActionAllowed(internalCtx, queueName, "job.retry");
      const { adapter } = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!adapter.supports.updateData || !adapter.updateJobData) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${adapter.getType()} does not support editing job data`,
        });
      }
      if (retry && !adapter.supports.retry) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${adapter.getType()} does not support retrying jobs`,
        });
      }
      // The viewer edits the data as it was presented to them. Saved back, a
      // redacted or hidden value would overwrite the real one.
      if (
        !resolvePrivacyExposure(internalCtx.privacy).jobData ||
        internalCtx.privacy?.redact
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Editing job data is disabled when job data is hidden or redacted",
        });
      }

      await adapter.updateJobData(jobId, data);
      if (retry) await adapter.retryJob(jobId);

      const job = await adapter.getJob(jobId);
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      return presentJob(job, internalCtx.privacy);
    }),
  // Moves a delayed job to run at another time; a time already past makes it
  // due now.
  changeDelay: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
        runAt: z.number().int().min(0),
      }),
    )
    .mutation(async ({ input: { queueName, jobId, runAt }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "job.changeDelay");
      const { adapter } = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!adapter.supports.changeDelay || !adapter.changeJobDelay) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${adapter.getType()} does not support rescheduling jobs`,
        });
      }
      const status = await adapter.getJobStatus(jobId);
      if (status === null && !(await adapter.getJob(jobId))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      if (status !== "delayed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: status
            ? `Only delayed jobs can be rescheduled; job is currently ${status}`
            : "Could not verify that the job is delayed",
        });
      }

      await adapter.changeJobDelay(jobId, Math.max(0, runAt - Date.now()));

      const job = await adapter.getJob(jobId);
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      const [current = job] = await withRunAts(adapter, "delayed", [job]);
      return presentJob(current, internalCtx.privacy);
    }),
  changePriority: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
        // 0 is no priority; otherwise lower numbers run first.
        priority: z.number().int().min(0).max(MAX_JOB_PRIORITY),
      }),
    )
    .mutation(async ({ input: { queueName, jobId, priority }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "job.changePriority");
      const { adapter } = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!adapter.supports.changePriority || !adapter.changeJobPriority) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${adapter.getType()} does not support changing priorities`,
        });
      }
      const status = toJobListStatus(await adapter.getJobStatus(jobId));
      if (status === null && !(await adapter.getJob(jobId))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      if (!status || !PRIORITIZABLE_STATUSES.includes(status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: status
            ? `Only jobs that haven't started can change priority; job is currently ${status}`
            : "Could not verify that the job hasn't started",
        });
      }

      await adapter.changeJobPriority(jobId, priority);

      const job = await adapter.getJob(jobId);
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      return presentJob(job, internalCtx.privacy);
    }),
  // Lets new jobs with this job's deduplication id in again, while this job
  // still holds it.
  removeDeduplication: procedure
    .input(z.object({ queueName: z.string(), jobId: z.string() }))
    .mutation(async ({ input: { queueName, jobId }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(
        internalCtx,
        queueName,
        "job.removeDeduplication",
      );
      const { adapter } = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!adapter.supports.deduplication || !adapter.removeJobDeduplication) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${adapter.getType()} does not support deduplication`,
        });
      }
      return { released: await adapter.removeJobDeduplication(jobId) };
    }),
  // What each kind of job in a queue does, by the name it was added under:
  // how many finished in the window, how many of those failed, and how long
  // the completed ones ran. Scans the newest completed and failed jobs, up to
  // the scan limit each, so a queue that keeps few answers for those alone.
  types: procedure
    .input(
      z.object({
        queueName: z.string(),
        minutes: z.number().int().min(1).max(MAX_RUN_TIME_WINDOW_MINUTES),
      }),
    )
    .query(async ({ input: { queueName, minutes }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      const { adapter } = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });
      if (!adapter.supports.jobNames) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${adapter.getType()} jobs have no names to group by`,
        });
      }

      const maxScanned = getEffectiveScanLimit(
        internalCtx,
        MAX_RUN_TIME_SAMPLE,
      );
      const cacheKey = JSON.stringify([getSnapshotOwner(adapter), maxScanned]);
      let scan = jobTypeScans.get(cacheKey);
      if (!scan || Date.now() - scan.createdAt >= RUN_TIME_SCAN_TTL_MS) {
        const samples: JobTypeSample[] = [];
        let scanned = 0;
        let scanLimitReached = false;
        for (const status of ["completed", "failed"] as const) {
          if (!adapter.supports.statuses.includes(status)) continue;
          const result = await scanJobsForStatus({
            adapter,
            maxScanned,
            privacy: internalCtx.privacy,
            status,
          });
          scanned += result.scanned;
          scanLimitReached ||= result.scanLimitReached;
          for (const { raw } of result.jobs) {
            const finishedAt = raw.finishedAt ?? raw.processedAt;
            if (!finishedAt) continue;
            const ran =
              status === "completed" && raw.processedAt && raw.finishedAt
                ? raw.finishedAt.getTime() - raw.processedAt.getTime()
                : null;
            samples.push({
              name: raw.rawName ?? raw.name,
              at: finishedAt.getTime(),
              failed: status === "failed",
              ms: ran !== null && ran >= 0 ? ran : null,
            });
          }
        }
        scan = { createdAt: Date.now(), samples, scanned, scanLimitReached };
        jobTypeScans.delete(cacheKey);
        if (jobTypeScans.size >= MAX_RUN_TIME_SCANS) {
          const oldest = jobTypeScans.keys().next().value;
          if (oldest !== undefined) jobTypeScans.delete(oldest);
        }
        jobTypeScans.set(cacheKey, scan);
      }

      const now = Date.now();
      const since = now - minutes * 60_000;
      const types = new Map<
        string,
        { completed: number; failed: number; runs: number[]; lastAt: number }
      >();
      for (const sample of scan.samples) {
        if (sample.at < since || sample.at > now) continue;
        let type = types.get(sample.name);
        if (!type) {
          type = { completed: 0, failed: 0, runs: [], lastAt: sample.at };
          types.set(sample.name, type);
        }
        type.lastAt = Math.max(type.lastAt, sample.at);
        if (sample.failed) {
          type.failed += 1;
        } else {
          type.completed += 1;
          if (sample.ms !== null) type.runs.push(sample.ms);
        }
      }

      return {
        now,
        minutes,
        scanned: scan.scanned,
        scanLimitReached: scan.scanLimitReached,
        types: Array.from(types, ([name, type]) => {
          const runs = type.runs.sort((left, right) => left - right);
          const total = type.completed + type.failed;
          return {
            name,
            completed: type.completed,
            failed: type.failed,
            failureRate: total > 0 ? type.failed / total : 0,
            p50: percentile(runs, 0.5),
            p95: percentile(runs, 0.95),
            lastFinishedAt: type.lastAt,
          };
        }).sort(
          (left, right) =>
            right.completed + right.failed - (left.completed + left.failed) ||
            left.name.localeCompare(right.name),
        ),
      };
    }),
  // Finds jobs in every queue the viewer can see: a job with that id first,
  // then jobs whose id, name, group, error or visible data contain the text.
  // The scan limit is shared out across the queues.
  find: procedure
    .input(
      z.object({
        query: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ input: { query, limit }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      // A match is opened by id, which redacted ids rule out.
      if (privacyRedactsJobIdentity(internalCtx.privacy)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Finding jobs is disabled when job identifiers are redacted",
        });
      }
      const { queues } = internalCtx;
      const perQueue = Math.max(
        MIN_FIND_SCAN_PER_QUEUE,
        Math.floor(
          getEffectiveScanLimit(internalCtx, MAX_JOB_SCAN_LIMIT) /
            Math.max(1, queues.length),
        ),
      );

      const searches: Array<
        Awaited<ReturnType<typeof searchQueueJobs>> & {
          queue: QueueInContext;
        }
      > = [];
      for (let index = 0; index < queues.length; index += FIND_CONCURRENCY) {
        const batch = queues.slice(index, index + FIND_CONCURRENCY);
        searches.push(
          ...(await Promise.all(
            batch.map(async (queue) => ({
              queue,
              ...(await searchQueueJobs({
                adapter: queue.adapter,
                maxScanned: perQueue,
                privacy: internalCtx.privacy,
                query,
                statuses: undefined,
                limit,
              })),
            })),
          )),
        );
      }

      const matches = searches.flatMap(({ queue, results }) =>
        results.map(({ job, status }, rank) => ({
          queueName: queue.adapter.getName(),
          queueDisplayName: queue.adapter.getDisplayName(),
          status,
          job,
          rank,
        })),
      );
      // An exact id first, then each queue's best match before any queue's
      // second, so one busy queue can't fill the list.
      matches.sort(
        (left, right) =>
          Number(right.job.id === query) - Number(left.job.id === query) ||
          left.rank - right.rank,
      );

      return {
        results: matches
          .slice(0, limit)
          .map(({ rank: _rank, ...match }) => match),
        scanned: searches.reduce((sum, search) => sum + search.scanned, 0),
        partial:
          matches.length > limit || searches.some(({ partial }) => partial),
      };
    }),
  errorGroups: procedure
    .input(
      z.object({
        queueName: z.string(),
        range: z.enum(["1h", "24h", "7d", "all"]).default("24h"),
      }),
    )
    .query(async ({ input: { queueName, range }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });
      const { adapter } = queueInCtx;
      if (!adapter.supports.statuses.includes("failed")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${adapter.getType()} does not keep failed jobs`,
        });
      }

      const maxScanned = getEffectiveScanLimit(internalCtx, MAX_JOB_SCAN_LIMIT);
      const cacheKey = JSON.stringify([getSnapshotOwner(adapter), maxScanned]);
      let scan = failureScans.get(cacheKey);
      if (!scan || Date.now() - scan.createdAt >= FAILURE_SCAN_TTL_MS) {
        const scanned = await scanJobsForStatus({
          adapter,
          maxScanned,
          privacy: internalCtx.privacy,
          status: "failed",
        });
        const failures: ScannedFailure[] = [];
        for (const { raw } of scanned.jobs) {
          const signature = getPresentedFailureSignature(
            raw,
            internalCtx.privacy,
          );
          if (!signature) continue;
          failures.push({
            at: (raw.finishedAt ?? raw.processedAt ?? raw.createdAt).getTime(),
            signature,
          });
        }
        scan = {
          createdAt: Date.now(),
          failures,
          scanned: scanned.scanned,
          scanLimitReached: scanned.scanLimitReached,
        };
        failureScans.delete(cacheKey);
        if (failureScans.size >= MAX_FAILURE_SCANS) {
          const oldest = failureScans.keys().next().value;
          if (oldest !== undefined) failureScans.delete(oldest);
        }
        failureScans.set(cacheKey, scan);
      }

      const now = Date.now();
      const since = now - ERROR_GROUP_RANGES_MS[range];
      const groups = new Map<
        string,
        FailureSignature & {
          count: number;
          firstSeen: number;
          lastSeen: number;
          // Failures per hour over the last 24 hours, oldest first.
          hourly: number[];
        }
      >();
      let failedInRange = 0;
      let oldestFailureAt: number | null = null;
      for (const { at, signature } of scan.failures) {
        oldestFailureAt =
          oldestFailureAt === null ? at : Math.min(oldestFailureAt, at);
        if (at < since) continue;
        failedInRange += 1;
        let group = groups.get(signature.fingerprint);
        if (!group) {
          group = {
            ...signature,
            count: 0,
            firstSeen: at,
            lastSeen: at,
            hourly: Array.from({ length: 24 }, () => 0),
          };
          groups.set(signature.fingerprint, group);
        }
        group.count += 1;
        group.firstSeen = Math.min(group.firstSeen, at);
        group.lastSeen = Math.max(group.lastSeen, at);
        const hoursAgo = Math.floor((now - at) / HOUR_MS);
        if (hoursAgo >= 0 && hoursAgo < 24) group.hourly[23 - hoursAgo] += 1;
      }

      return {
        now,
        range,
        scanned: scan.scanned,
        scanLimitReached: scan.scanLimitReached,
        failedInRange,
        // How far back the kept failures reach, so "new" can mean new rather
        // than "older failures were already removed".
        oldestFailureAt,
        groups: Array.from(groups.values()).sort(
          (left, right) =>
            right.count - left.count || right.lastSeen - left.lastSeen,
        ),
      };
    }),
  // How long the queue's jobs take to run: p50 and p95 of the last run of every
  // job that completed in the window, from its start and finish timestamps.
  // Scans the newest completed jobs, up to the scan limit, so a queue that
  // keeps few completed jobs answers for those alone.
  runTimes: procedure
    .input(
      z.object({
        queueName: z.string(),
        minutes: z.number().int().min(1).max(MAX_RUN_TIME_WINDOW_MINUTES),
      }),
    )
    .query(async ({ input: { queueName, minutes }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });
      const { adapter } = queueInCtx;
      if (!adapter.supports.statuses.includes("completed")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${adapter.getType()} does not keep completed jobs`,
        });
      }

      const maxScanned = getEffectiveScanLimit(
        internalCtx,
        MAX_RUN_TIME_SAMPLE,
      );
      const cacheKey = JSON.stringify([getSnapshotOwner(adapter), maxScanned]);
      let scan = runTimeScans.get(cacheKey);
      if (!scan || Date.now() - scan.createdAt >= RUN_TIME_SCAN_TTL_MS) {
        const scanned = await scanJobsForStatus({
          adapter,
          maxScanned,
          privacy: internalCtx.privacy,
          status: "completed",
        });
        const runs: RunSample[] = [];
        for (const { raw } of scanned.jobs) {
          if (!raw.processedAt || !raw.finishedAt) continue;
          const ms = raw.finishedAt.getTime() - raw.processedAt.getTime();
          if (ms >= 0) runs.push({ at: raw.finishedAt.getTime(), ms });
        }
        scan = {
          createdAt: Date.now(),
          runs,
          scanned: scanned.scanned,
          scanLimitReached: scanned.scanLimitReached,
        };
        runTimeScans.delete(cacheKey);
        if (runTimeScans.size >= MAX_RUN_TIME_SCANS) {
          const oldest = runTimeScans.keys().next().value;
          if (oldest !== undefined) runTimeScans.delete(oldest);
        }
        runTimeScans.set(cacheKey, scan);
      }

      const now = Date.now();
      return {
        now,
        minutes,
        scanned: scan.scanned,
        scanLimitReached: scan.scanLimitReached,
        // Whole minutes, like queue.metrics: the minute under way is still
        // filling, and the Health strip puts these beside its counts.
        ...summarizeRunTimes(scan.runs, {
          now: Math.floor(now / 60_000) * 60_000,
          minutes,
          buckets: RUN_TIME_BUCKETS,
        }),
      };
    }),
  list: procedure
    .input(
      z.object({
        queueName: z.string(),
        cursor: z.number().int().min(0).optional().default(0),
        limit: z.number().int().min(1).max(100),
        status: z.enum(JOB_STATUSES),
        groupId: z.string().min(1).optional(),
        query: z.string().trim().min(1).max(200).optional(),
        name: JOB_NAME,
        ...TIME_RANGE_INPUT,
        // Only jobs in this error group (see job.errorGroups).
        error: ERROR_FINGERPRINT.optional(),
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
          name,
          from,
          to,
          fromOffset,
          toOffset,
          error,
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
        const range = resolveTimeRange({ from, to, fromOffset, toOffset });

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
        // Finished jobs a library keeps sorted by finish time turn a date
        // range into a stretch of the list: exact, and no scan limit.
        const window = await getFinishedWindow(
          queueInCtx.adapter,
          status,
          range,
        );
        const usesBoundedScan = Boolean(
          groupId ||
          query ||
          error ||
          name ||
          sort === "newest" ||
          sort === "oldest" ||
          (hasTimeRange(range) && !window),
        );

        if (window && !usesBoundedScan) {
          const end = Math.min(cursor + limit, window.count);
          const page =
            cursor < end
              ? await queueInCtx.adapter.getJobs(
                  status,
                  window.offset + cursor,
                  window.offset + end - 1,
                )
              : [];
          return {
            totalCount: window.count,
            numOfPages: Math.ceil(window.count / limit),
            nextCursor: end < window.count ? end : undefined,
            jobs: page.map((job) => presentJob(job, internalCtx.privacy)),
            searchMeta: undefined,
          };
        }
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
            errorFingerprint: error,
            groupId,
            jobName: name,
            query,
            range: { from, to, fromOffset, toOffset },
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
            const jobs = await withRunAts(
              queueInCtx.adapter,
              status,
              (
                await Promise.all(
                  snapshot.ids
                    .slice(cursor, pageEnd)
                    .map((jobId) => queueInCtx.adapter.getJob(jobId)),
                )
              ).filter((job): job is AdaptedJob => job !== null),
            );
            const totalCount = snapshot.ids.length;

            return {
              totalCount,
              numOfPages: Math.ceil(totalCount / limit),
              nextCursor: getNextCursor(totalCount),
              // A job removed since page 1 drops out of its page.
              jobs: jobs.map((job) => presentJob(job, internalCtx.privacy)),
              searchMeta: {
                scanned: snapshot.scanned,
                capped: snapshot.scanLimitReached,
                scanLimit: effectiveScanLimit,
              },
            };
          }

          const scan = await scanJobsForStatus({
            adapter: queueInCtx.adapter,
            errorFingerprint: error,
            groupId,
            jobName: name,
            maxScanned: effectiveScanLimit,
            privacy: internalCtx.privacy,
            query,
            range,
            searchInData,
            status,
            window,
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
          const pageMatches = matches.slice(cursor, pageEnd);
          const runAts = new Map(
            (
              await withRunAts(
                queueInCtx.adapter,
                status,
                pageMatches.map(({ raw }) => raw),
              )
            ).map((job) => [job.id, job.runAt]),
          );

          return {
            totalCount,
            numOfPages: Math.ceil(totalCount / limit),
            nextCursor: getNextCursor(totalCount),
            jobs: pageMatches.map(({ presented, raw }) => {
              const job = presented ?? presentJob(raw, internalCtx.privacy);
              const runAt = runAts.get(raw.id);
              return runAt === undefined ? job : { ...job, runAt };
            }),
            searchMeta: {
              scanned: scan.scanned,
              capped: scan.scanLimitReached,
              scanLimit: effectiveScanLimit,
            },
            // What the error filter is, so the page can name it without a
            // second request.
            errorGroup:
              error && matches[0]
                ? getPresentedFailureSignature(
                    matches[0].raw,
                    internalCtx.privacy,
                    matches[0].presented,
                  )
                : null,
          };
        }

        const page = await queueInCtx.adapter.getJobs(
          status,
          cursor,
          pageEnd - 1,
        );
        // Read before the due times are added: the adapter keys its page
        // details to the array it returned.
        const adapterPageMeta = queueInCtx.adapter.getJobPageMeta?.(page);
        const jobs = await withRunAts(queueInCtx.adapter, status, page);
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
