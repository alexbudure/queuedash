import type { RedisInfo } from "redis-info";

// Common job options shared across queue adapters
export type JobOptions = {
  priority?: number;
  attempts?: number;
  delay?: number;
  lifo?: boolean;
  repeat?: {
    count?: number;
    pattern?: string;
    every?: number;
    limit?: number;
  };
  [key: string]: unknown; // Allow additional adapter-specific options
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
};

export type JobCounts = Partial<Record<string, number>>;

// Per-operation feature support with details
export type FeatureSupport<SupportedStatus extends string = string> = {
  pause: boolean;
  resume: boolean;
  clean: boolean | { supportedStatuses: SupportedStatus[] }; // Can specify which statuses are cleanable
  retry: boolean;
  promote: boolean;
  logs: boolean;
  schedulers: boolean;
  flows: boolean;
  priorities: boolean;
  empty: boolean; // Whether queue can be completely emptied
  statuses: SupportedStatus[]; // Which statuses this queue actually supports
};

export type SchedulerInfo = {
  key: string;
  name: string;
  id?: string | null;
  iterationCount?: number;
  limit?: number;
  endDate?: number;
  tz?: string;
  pattern?: string;
  every?: number;
  next?: number;
  template?: {
    data?: Record<string, unknown>;
  };
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
  ): Promise<AdaptedJob[]>;
  abstract getJob(jobId: string): Promise<AdaptedJob | null>;
  abstract addJob(
    data: Record<string, unknown>,
    opts?: Record<string, unknown>,
  ): Promise<AdaptedJob>;
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
  removeScheduler?(key: string): Promise<void>;

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
