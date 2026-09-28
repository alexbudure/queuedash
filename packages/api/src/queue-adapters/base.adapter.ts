import type { RedisInfo } from "redis-info";

// Common job options shared across queue adapters
export type JobOptions = {
  priority?: number;
  attempts?: number;
  delay?: number;
  lifo?: boolean;
  timeout?: number;
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
  repeat?: {
    count?: number;
    pattern?: string;
    every?: number;
    limit?: number;
  };
};

export type AdaptedJob = {
  id: string;
  name: string;
  data: Record<string, unknown>;
  opts: JobOptions;
  createdAt: Date;
  processedAt: Date | null;
  finishedAt: Date | null;
  failedReason?: string;
  stacktrace?: string[];
  retriedAt: Date | null;
  returnValue?: unknown;
  groupId?: string; // Group identifier for GroupMQ and BullMQ Pro
  progress?: number; // Job progress (0-100)
  attemptsMade?: number; // Number of attempts made
};

export type JobCounts = Partial<Record<string, number>>;

/** The listed options that are set on `opts`, to carry them to another job. */
export const pickJobOptions = (
  opts: Record<string, unknown> | undefined,
  keys: readonly string[],
): Record<string, unknown> => {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (opts?.[key] !== undefined) picked[key] = opts[key];
  }
  return picked;
};

export type JobPageMeta = {
  capped: boolean;
  cursorAdvance?: number;
  exhausted?: boolean;
  scanned: number;
  scanLimit: number;
  // The adapter could not see every job of this status, as GroupMQ can't past
  // its first 5,000 groups, so a larger scan limit would not reach the rest.
  // `capped` alone may only mean the caller's own limit was reached, which a
  // scan that raises its limit a batch at a time hits on every page. A
  // truncated page is also capped.
  truncated?: boolean;
};

export type JobScanToken = symbol;

// Per-operation feature support with details
export type FeatureSupport<SupportedStatus extends string = string> = {
  addJobOptions: boolean;
  addJobOptionKeys: readonly string[]; // The exact option keys a manually added job may set
  pause: boolean;
  resume: boolean;
  clean: boolean | { supportedStatuses: SupportedStatus[] }; // Can specify which statuses are cleanable
  discard: boolean;
  retry: boolean;
  promote: boolean;
  logs: boolean;
  schedulers: boolean;
  schedulerUpdate: boolean;
  flows: boolean;
  priorities: boolean;
  empty: boolean; // Whether queue can be completely emptied
  metrics: boolean; // Whether queue supports time-based metrics (completed/failed counts)
  statuses: SupportedStatus[]; // Which statuses this queue actually supports
  groups: boolean; // Whether queue supports job groups (GroupMQ, BullMQ Pro)
  workers: boolean; // Whether active queue workers can be inspected
};

export type SchedulerInfo = {
  key: string;
  name: string;
  id?: string | null;
  iterationCount?: number;
  limit?: number;
  startDate?: number;
  endDate?: number;
  tz?: string;
  pattern?: string;
  every?: number;
  next?: number;
  offset?: number;
  template?: {
    name?: string;
    data?: Record<string, unknown>;
    opts?: Record<string, unknown>;
  };
};

export class UnsupportedSchedulerUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedSchedulerUpdateError";
  }
}

// Thrown by the by-id job operations when the id is not a job of this queue,
// including ids that name one of the queue's own Redis keys ("meta",
// "repeat:<id>", ...), so callers can answer "not found" rather than fail.
export class JobNotFoundError extends Error {
  constructor(message = "Job not found") {
    super(message);
    this.name = "JobNotFoundError";
  }
}

// A window of `[start, end)` minutes ago, counted back from now.
export type QueueMetrics = {
  data: number[]; // One count per minute, newest first, zero when none finished
  count: number; // Sum of `data`
  previousCount: number | null; // Sum over the preceding equal window; null when history does not reach it
  coveredMinutes: number; // Minutes of the window inside the queue's metrics history; the rate denominator
  // Raw library values. `prevCount` is a lifetime total, not a trend baseline.
  meta: {
    count: number; // Total since queue started
    prevTS: number; // Previous timestamp
    prevCount: number; // Count from previous period
  };
};

// A job's parent in a BullMQ flow. `queueKey` is the parent queue's Redis key
// prefix ("bull:orders"), which is all a job records about where it lives.
export type FlowParent = {
  queueKey: string;
  id: string;
  // Whether the child was added with failParentOnFailure,
  // ignoreDependencyOnFailure, removeDependencyOnFailure or
  // continueParentOnFailure. Without any of them a failed child holds its
  // parent in waiting-children until it is retried or removed.
  failureHandled: boolean;
};

// Where BullMQ keeps a child: `processed` once it completed, `unprocessed`
// until then (a failed child with no failure handling stays here), `failed`
// and `ignored` for failures the parent was told to act on or skip.
export type FlowChildSet = "processed" | "unprocessed" | "failed" | "ignored";

export type FlowChildren = {
  total: number;
  // Child job keys (`${queueKey}:${id}`), the ones still pending first.
  keys: Array<{ key: string; set: FlowChildSet }>;
};

export type GroupInfo = {
  id: string;
  count: number;
  status: "active" | "paused" | "rate-limited";
};

export type WorkerInfo = {
  id: string;
  name?: string;
  ageSeconds?: number;
  idleSeconds?: number;
};

export abstract class QueueAdapter<
  SupportedStatus extends string = string,
  CleanableStatus extends SupportedStatus = SupportedStatus,
> {
  protected displayName: string;
  protected jobNameFn?: (data: Record<string, unknown>) => string;

  constructor(
    displayName: string,
    jobNameFn?: (data: Record<string, unknown>) => string,
  ) {
    this.displayName = displayName;
    this.jobNameFn = jobNameFn;
  }

  // Metadata
  abstract getName(): string;
  abstract getType(): "bull" | "bullmq" | "bee" | "groupmq";

  getDisplayName(): string {
    return this.displayName;
  }

  // Feature flags - each adapter defines what it supports
  abstract supports: FeatureSupport<SupportedStatus>;

  // Queue operations
  abstract getJobCounts(): Promise<JobCounts>;
  // Health polls need only this; adapters override the full count with a
  // single cheap read where the library offers one.
  async getFailedCount(): Promise<number> {
    return (await this.getJobCounts()).failed ?? 0;
  }
  abstract isPaused(): Promise<boolean>;
  abstract pause(): Promise<void>;
  abstract resume(): Promise<void>;
  abstract empty(): Promise<void>;
  abstract clean(status: CleanableStatus, graceMs: number): Promise<void>;
  abstract getRedisInfo(): Promise<RedisInfo & { maxclients: string }>;

  // Job operations
  abstract getJobs(
    status: SupportedStatus,
    start: number,
    end: number,
    scanLimit?: number,
    scanToken?: JobScanToken,
  ): Promise<AdaptedJob[]>;
  beginJobScan(
    _status: SupportedStatus,
    _scanLimit?: number,
  ): JobScanToken | undefined {
    return undefined;
  }
  endJobScan(_scanToken: JobScanToken): void {
    // Stateful adapters can eagerly release per-request snapshots here.
  }
  getJobPageMeta(_jobs: AdaptedJob[]): JobPageMeta | undefined {
    return undefined;
  }
  abstract getJob(jobId: string): Promise<AdaptedJob | null>;
  async getJobStatus(jobId: string): Promise<SupportedStatus | null> {
    void jobId;
    return null;
  }
  abstract addJob(
    data: Record<string, unknown>,
    opts?: Record<string, unknown>,
  ): Promise<AdaptedJob>;
  // Adds a new job with an existing job's name, data and the options that
  // decide how it runs: workers dispatch on the name, and attempts or backoff
  // are the producer's choice. Never its id, delay, schedule or flow parent: a
  // rerun is a new job that runs now. Throws JobNotFoundError for an unknown id.
  abstract rerunJob(jobId: string): Promise<AdaptedJob>;
  abstract removeJob(jobId: string): Promise<void>;
  abstract retryJob(jobId: string): Promise<void>;
  abstract promoteJob(jobId: string): Promise<void>;
  abstract discardJob(jobId: string): Promise<void>;
  abstract getJobLogs(jobId: string): Promise<string[] | null>;

  // Scheduler operations (optional - only for queues that support it)
  getSchedulers?(): Promise<SchedulerInfo[]>;
  addScheduler?(
    name: string,
    opts: Record<string, unknown>,
    template: Record<string, unknown>,
  ): Promise<void>;
  updateScheduler?(
    key: string,
    opts: Record<string, unknown>,
    template: Record<string, unknown>,
  ): Promise<boolean>;
  removeScheduler?(key: string): Promise<void>;

  // Metrics operations (optional - only for queues that support it)
  getMetrics?(
    type: "completed" | "failed",
    start: number,
    end: number,
  ): Promise<QueueMetrics>;

  // Flow operations (optional - only for queues that support flows)
  // The queue's Redis key prefix, which is how flows name a job's queue.
  getQueueKey?(): string;
  getJobParent?(jobId: string): Promise<FlowParent | null>;
  // Up to `limit` of the job's children; throws JobNotFoundError.
  getJobChildren?(jobId: string, limit: number): Promise<FlowChildren>;

  // Group operations (optional - only for queues that support it)
  async getGroups(): Promise<GroupInfo[]> {
    return []; // Default: no groups
  }

  // Worker inspection (optional - normalized to avoid returning raw Redis data).
  // Null means this Redis cannot be asked (e.g. CLIENT is disabled), which must
  // not read as "no workers".
  async getWorkers(): Promise<WorkerInfo[] | null> {
    return [];
  }

  // Helper methods
  protected getJobName(
    data: Record<string, unknown>,
    fallback: string,
  ): string {
    if (this.jobNameFn) {
      return this.jobNameFn(data);
    }
    return fallback;
  }

  // Helper to check if status is supported
  supportsStatus(status: SupportedStatus): boolean {
    return this.supports.statuses.includes(status);
  }

  // Helper to check if status can be cleaned
  canCleanStatus(status: SupportedStatus): status is CleanableStatus {
    if (typeof this.supports.clean === "boolean") {
      return this.supports.clean && this.supportsStatus(status);
    }
    return this.supports.clean.supportedStatuses.includes(
      status as SupportedStatus,
    );
  }
}
