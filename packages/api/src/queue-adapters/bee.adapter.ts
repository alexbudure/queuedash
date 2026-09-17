import type BeeQueue from "bee-queue";

import {
  QueueAdapter,
  type AdaptedJob,
  type JobCounts,
  type FeatureSupport,
  type JobPageMeta,
  type JobScanToken,
} from "./base.adapter";

type BeeStatus = "waiting" | "active" | "completed" | "failed" | "delayed";

type BeeCleanableStatus = never;

const MAX_BEE_SET_PAGE_OFFSET = 5_000;
const BEE_SET_SCAN_LIMIT = MAX_BEE_SET_PAGE_OFFSET + 1;
const BEE_SET_SCAN_BATCH_SIZE = 100;
const BEE_SET_SNAPSHOT_IDLE_TTL_MS = 60_000;

type BeeSetStatus = "failed" | "succeeded";
type BeeSnapshotKey = JobScanToken;

type BeeSetSnapshot = {
  cursor: string;
  exhausted: boolean;
  ids: string[];
  lastAccessedAt: number;
  seen: Set<string>;
};

type BeeQueueInternals = {
  client: {
    lrange: (
      key: string,
      start: number,
      end: number,
      callback: (error: Error | null, ids: string[]) => void,
    ) => void;
    sscan: (
      key: string,
      cursor: string,
      countKeyword: "COUNT",
      count: number,
      callback: (error: Error | null, result: [string, string[]]) => void,
    ) => void;
    zrange: (
      key: string,
      start: number,
      end: number,
      callback: (error: Error | null, ids: string[]) => void,
    ) => void;
  };
  toKey: (status: string) => string;
};

export class BeeAdapter extends QueueAdapter<BeeStatus, BeeCleanableStatus> {
  private queue: BeeQueue;
  private setSnapshots = new Map<BeeSnapshotKey, BeeSetSnapshot>();
  private setSnapshotExpiries = new Map<
    BeeSnapshotKey,
    ReturnType<typeof setTimeout>
  >();
  private setSnapshotTails = new Map<BeeSnapshotKey, Promise<void>>();
  private pageMeta = new WeakMap<AdaptedJob[], JobPageMeta>();

  supports: FeatureSupport<BeeStatus> = {
    addJobOptions: false,
    pause: false,
    resume: false,
    clean: false,
    discard: false,
    retry: false,
    promote: false,
    logs: false,
    schedulers: false,
    schedulerUpdate: false,
    flows: false,
    priorities: false,
    empty: false,
    metrics: false,
    statuses: ["waiting", "active", "completed", "failed", "delayed"],
    groups: false,
    workers: false,
  };

  constructor(
    queue: BeeQueue,
    displayName: string,
    jobNameFn?: (data: Record<string, unknown>) => string,
  ) {
    super(displayName, jobNameFn);
    this.queue = queue;
  }

  getName(): string {
    return this.queue.name;
  }

  getType(): "bee" {
    return "bee";
  }

  beginJobScan(
    status: BeeStatus,
    _scanLimit?: number,
  ): JobScanToken | undefined {
    const setStatus = status === "completed" ? "succeeded" : status;
    if (setStatus !== "succeeded" && setStatus !== "failed") return undefined;
    return Symbol(`bee-${setStatus}-scan`);
  }

  endJobScan(scanToken: JobScanToken): void {
    const expiry = this.setSnapshotExpiries.get(scanToken);
    if (expiry) clearTimeout(expiry);
    this.setSnapshotExpiries.delete(scanToken);
    this.setSnapshots.delete(scanToken);
    this.setSnapshotTails.delete(scanToken);
  }

  async getJobCounts(): Promise<JobCounts> {
    const counts = await this.queue.checkHealth();
    return {
      active: counts.active,
      waiting: counts.waiting,
      completed: counts.succeeded, // Bee uses "succeeded" not "completed"
      failed: counts.failed,
      delayed: counts.delayed,
    };
  }

  async isPaused(): Promise<boolean> {
    return this.queue.paused;
  }

  async pause(): Promise<void> {
    throw new Error("Bee-Queue does not support pausing");
  }

  async resume(): Promise<void> {
    throw new Error("Bee-Queue does not support resuming");
  }

  async empty(): Promise<void> {
    throw new Error("Bee-Queue does not support emptying queues");
  }

  async clean(status: BeeCleanableStatus, graceMs: number): Promise<void> {
    void status;
    void graceMs;
    throw new Error("Bee-Queue does not support cleaning jobs");
  }

  async getRedisInfo() {
    // @ts-expect-error Bee-Queue doesn't have typed client property
    const info = this.queue.client.server_info;
    return {
      ...info,
      maxclients: info.maxclients || "0",
    };
  }

  async getJobs(
    status: BeeStatus,
    start: number,
    end: number,
    scanLimit?: number,
    scanToken?: JobScanToken,
  ): Promise<AdaptedJob[]> {
    type BeeQueueStatus =
      | "waiting"
      | "active"
      | "succeeded"
      | "failed"
      | "delayed";
    const normalizedStatus: BeeQueueStatus =
      status === "completed" ? "succeeded" : (status as BeeQueueStatus);
    const isSetStatus =
      normalizedStatus === "failed" || normalizedStatus === "succeeded";
    if (isSetStatus && end > MAX_BEE_SET_PAGE_OFFSET) {
      throw new Error(
        `Bee-Queue completed/failed pagination is limited to the first ${MAX_BEE_SET_PAGE_OFFSET.toLocaleString()} jobs`,
      );
    }

    if (isSetStatus) {
      return this.getSetJobsPage(normalizedStatus, start, end, scanToken);
    }

    const [jobs, jobIds] = await Promise.all([
      this.queue.getJobs(normalizedStatus, {
        start,
        end,
        size: end - start + 1,
      }),
      this.getOrderedJobIds(normalizedStatus, start, end),
    ]);
    const jobsById = new Map(jobs.map((job) => [String(job.id), job]));
    const adapted = jobIds.flatMap((jobId) => {
      const job = jobsById.get(jobId);
      return job ? [this.adaptJob(job)] : [];
    });
    const requested = end - start + 1;
    this.pageMeta.set(adapted, {
      capped: false,
      cursorAdvance: Math.min(jobIds.length, requested),
      exhausted: jobIds.length < requested,
      scanned: start + jobIds.length,
      scanLimit: scanLimit ?? Math.max(end + 1, 1),
    });
    return adapted;
  }

  private async getOrderedJobIds(
    status: "waiting" | "active" | "delayed",
    start: number,
    end: number,
  ): Promise<string[]> {
    await this.queue.ready();
    const queue = this.queue as unknown as BeeQueueInternals;
    return new Promise<string[]>((resolve, reject) => {
      const callback = (error: Error | null, ids: string[]) => {
        if (error) reject(error);
        else resolve(ids);
      };
      if (status === "delayed") {
        queue.client.zrange(queue.toKey(status), start, end, callback);
      } else {
        queue.client.lrange(queue.toKey(status), start, end, callback);
      }
    });
  }

  async getJob(jobId: string): Promise<AdaptedJob | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;
    return this.adaptJob(job);
  }

  async getJobStatus(jobId: string): Promise<BeeStatus | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;
    if (job.status === "succeeded") return "completed";
    if (job.status === "failed") return "failed";

    // Bee-Queue persists waiting, active, and delayed jobs with the same
    // `created` status. Avoid guessing when the exact queue state is unknown.
    return null;
  }

  async addJob(data: Record<string, unknown>): Promise<AdaptedJob> {
    const job = await this.queue.createJob(data).save();
    return this.adaptJob(job);
  }

  async removeJob(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (!job) throw new Error("Job not found");
    await job.remove();
  }

  async retryJob(): Promise<void> {
    throw new Error("Bee-Queue does not support retrying jobs");
  }

  async promoteJob(): Promise<void> {
    throw new Error("Bee-Queue does not support promoting jobs");
  }

  async discardJob(jobId: string): Promise<void> {
    void jobId;
    throw new Error("Bee-Queue does not support discarding jobs");
  }

  async getJobLogs(): Promise<string[] | null> {
    return null; // Bee-Queue doesn't support job logs
  }

  private async scanSet(
    status: BeeSetStatus,
    snapshot: BeeSetSnapshot,
    count: number,
  ): Promise<void> {
    await this.queue.ready();
    const queue = this.queue as unknown as BeeQueueInternals;
    const [cursor, ids] = await new Promise<[string, string[]]>(
      (resolve, reject) => {
        queue.client.sscan(
          queue.toKey(status),
          snapshot.cursor,
          "COUNT",
          count,
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          },
        );
      },
    );

    snapshot.cursor = cursor;
    for (const id of ids) {
      if (snapshot.ids.length >= BEE_SET_SCAN_LIMIT) break;
      if (snapshot.seen.has(id)) continue;
      snapshot.seen.add(id);
      snapshot.ids.push(id);
    }
    snapshot.exhausted = cursor === "0";
  }

  private scheduleSetSnapshotExpiry(
    snapshotKey: BeeSnapshotKey,
    snapshot: BeeSetSnapshot,
  ): void {
    snapshot.lastAccessedAt = Date.now();
    const existing = this.setSnapshotExpiries.get(snapshotKey);
    if (existing) clearTimeout(existing);

    const expiry = setTimeout(() => {
      if (this.setSnapshots.get(snapshotKey) === snapshot) {
        this.setSnapshots.delete(snapshotKey);
      }
      this.setSnapshotExpiries.delete(snapshotKey);
    }, BEE_SET_SNAPSHOT_IDLE_TTL_MS);
    expiry.unref?.();
    this.setSnapshotExpiries.set(snapshotKey, expiry);
  }

  private createSetSnapshot(): BeeSetSnapshot {
    return {
      cursor: "0",
      exhausted: false,
      ids: [],
      lastAccessedAt: Date.now(),
      seen: new Set<string>(),
    };
  }

  private async populateSetSnapshot(
    status: BeeSetStatus,
    snapshot: BeeSetSnapshot,
    end: number,
  ): Promise<void> {
    while (
      snapshot.ids.length <= end &&
      !snapshot.exhausted &&
      snapshot.ids.length < BEE_SET_SCAN_LIMIT
    ) {
      await this.scanSet(
        status,
        snapshot,
        Math.min(
          BEE_SET_SCAN_BATCH_SIZE,
          BEE_SET_SCAN_LIMIT - snapshot.ids.length,
        ),
      );
    }
  }

  private async readSetSnapshotPage(
    snapshot: BeeSetSnapshot,
    start: number,
    end: number,
  ): Promise<AdaptedJob[]> {
    const ids = snapshot.ids.slice(start, end + 1);
    const jobs = await Promise.all(ids.map((id) => this.queue.getJob(id)));
    const adapted = jobs
      .filter(
        (job): job is BeeQueue.Job<Record<string, unknown>> => job != null,
      )
      .map((job) => this.adaptJob(job));
    const requested = end - start + 1;
    this.pageMeta.set(adapted, {
      capped:
        snapshot.ids.length > MAX_BEE_SET_PAGE_OFFSET ||
        (!snapshot.exhausted && snapshot.ids.length >= BEE_SET_SCAN_LIMIT),
      cursorAdvance: Math.min(ids.length, requested),
      exhausted: snapshot.exhausted && snapshot.ids.length <= end + 1,
      scanned: Math.min(end + 1, snapshot.ids.length, MAX_BEE_SET_PAGE_OFFSET),
      scanLimit: MAX_BEE_SET_PAGE_OFFSET,
    });
    return adapted;
  }

  private async getSetJobsPage(
    status: BeeSetStatus,
    start: number,
    end: number,
    scanToken?: JobScanToken,
  ): Promise<AdaptedJob[]> {
    // Direct pagination has no client-owned continuation token. Keep those
    // reads stateless so one browser cannot reset or reuse another browser's
    // SSCAN snapshot. Internal bounded scans provide an explicit token and
    // retain their snapshot across batches.
    if (!scanToken) {
      const snapshot = this.createSetSnapshot();
      await this.populateSetSnapshot(status, snapshot, end);
      return this.readSetSnapshotPage(snapshot, start, end);
    }

    const snapshotKey: BeeSnapshotKey = scanToken;
    const precedingRequest =
      this.setSnapshotTails.get(snapshotKey) ?? Promise.resolve();
    let releaseRequest = () => {};
    const requestTail = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    this.setSnapshotTails.set(snapshotKey, requestTail);
    await precedingRequest;

    const existingExpiry = this.setSnapshotExpiries.get(snapshotKey);
    if (existingExpiry) {
      clearTimeout(existingExpiry);
      this.setSnapshotExpiries.delete(snapshotKey);
    }

    let snapshot = this.setSnapshots.get(snapshotKey);
    try {
      const now = Date.now();
      if (
        !snapshot ||
        now - snapshot.lastAccessedAt > BEE_SET_SNAPSHOT_IDLE_TTL_MS
      ) {
        snapshot = this.createSetSnapshot();
        this.setSnapshots.set(snapshotKey, snapshot);
      }

      await this.populateSetSnapshot(status, snapshot, end);
      return this.readSetSnapshotPage(snapshot, start, end);
    } finally {
      if (snapshot && this.setSnapshots.get(snapshotKey) === snapshot) {
        this.scheduleSetSnapshotExpiry(snapshotKey, snapshot);
      }
      releaseRequest();
      if (this.setSnapshotTails.get(snapshotKey) === requestTail) {
        this.setSnapshotTails.delete(snapshotKey);
      }
    }
  }

  getJobPageMeta(jobs: AdaptedJob[]): JobPageMeta | undefined {
    return this.pageMeta.get(jobs);
  }

  private adaptJob(job: BeeQueue.Job<Record<string, unknown>>): AdaptedJob {
    const jobName =
      job.id === "__default__" ? "Default" : this.getJobName(job.data, job.id);

    // Bee-Queue job has status and progress properties
    const jobWithMeta = job as BeeQueue.Job<Record<string, unknown>> & {
      status?: string;
      progress?: unknown;
    };

    const progress =
      jobWithMeta.progress && typeof jobWithMeta.progress === "object"
        ? (jobWithMeta.progress as {
            created?: number;
            started?: number;
            succeeded?: number;
            failed?: number;
          })
        : undefined;

    const jobOptions = job.options as {
      timestamp?: number | string;
      stacktraces?: string[];
    };
    const createdTimestamp =
      typeof jobOptions.timestamp === "number"
        ? jobOptions.timestamp
        : typeof jobOptions.timestamp === "string"
          ? Number(jobOptions.timestamp)
          : undefined;
    const stacktrace = Array.isArray(jobOptions.stacktraces)
      ? jobOptions.stacktraces
      : [];

    // Bee-Queue always stores the enqueue timestamp in job options.
    const createdAt =
      progress?.created != null
        ? new Date(progress.created)
        : createdTimestamp != null && Number.isFinite(createdTimestamp)
          ? new Date(createdTimestamp)
          : new Date();
    const processedAt =
      progress?.started != null ? new Date(progress.started) : null;
    const finishedTimestamp = progress?.succeeded ?? progress?.failed;
    const finishedAt =
      finishedTimestamp != null ? new Date(finishedTimestamp) : null;

    return {
      id: job.id as string,
      name: jobName,
      data: job.data,
      opts: job.options as Record<string, unknown>,
      createdAt,
      processedAt,
      finishedAt,
      failedReason:
        jobWithMeta.status === "failed"
          ? stacktrace[0] || "Job failed"
          : undefined,
      stacktrace,
      retriedAt: null,
      returnValue: undefined, // Bee-Queue doesn't support return values
      progress: undefined, // Bee-Queue doesn't expose progress in the same way
      attemptsMade: undefined, // Bee-Queue doesn't track attempts
    };
  }
}
