import { createHash, randomUUID } from "node:crypto";

import type { Queue as BullMQQueue, Job as BullMQJob } from "bullmq";
import { parse } from "redis-info";

import {
  QueueAdapter,
  type AdaptedJob,
  type JobCounts,
  type FeatureSupport,
  type GroupInfo,
  type JobPageMeta,
  type SchedulerInfo,
  UnsupportedSchedulerUpdateError,
  type WorkerInfo,
} from "./base.adapter";

type BullMQStatus =
  | "waiting"
  | "waiting-children"
  | "active"
  | "completed"
  | "failed"
  | "delayed"
  | "paused"
  | "prioritized";

type BullMQCleanableStatus = Exclude<BullMQStatus, "waiting-children">;

type BullMQProQueueLike = {
  getGroups?: (start?: number, end?: number) => Promise<unknown[]>;
  getGroupJobsCount?: (groupId: string) => Promise<number>;
  getGroupJobCount?: (groupId: string) => Promise<number>;
};

const SCHEDULER_LOCK_TTL_MS = 30_000;
const SCHEDULER_LOCK_RENEW_MS = Math.floor(SCHEDULER_LOCK_TTL_MS / 3);
const SCHEDULER_LOCK_WAIT_MS = 5_000;
const SCHEDULER_LOCK_RETRY_MS = 25;
const RELEASE_SCHEDULER_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;
const EXTEND_SCHEDULER_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`;

const isLegacyRepeatable = (scheduler: SchedulerInfo): boolean =>
  Object.prototype.hasOwnProperty.call(scheduler, "id");

export class BullMQAdapter extends QueueAdapter<
  BullMQStatus,
  BullMQCleanableStatus
> {
  private queue: BullMQQueue;
  private pageMeta = new WeakMap<AdaptedJob[], JobPageMeta>();

  supports: FeatureSupport<BullMQStatus> = {
    addJobOptions: true,
    pause: true,
    resume: true,
    clean: {
      supportedStatuses: [
        "waiting",
        "active",
        "completed",
        "failed",
        "delayed",
        "paused",
        "prioritized",
      ],
    },
    discard: false,
    retry: true,
    promote: true,
    logs: true,
    schedulers: true,
    schedulerUpdate: true,
    flows: true,
    priorities: true,
    empty: true,
    metrics: true,
    statuses: [
      "waiting",
      "waiting-children",
      "active",
      "completed",
      "failed",
      "delayed",
      "paused",
      "prioritized",
    ],
    groups: false,
    workers: true,
  };

  constructor(
    queue: BullMQQueue,
    displayName: string,
    jobNameFn?: (data: Record<string, unknown>) => string,
  ) {
    super(displayName, jobNameFn);
    this.queue = queue;
    this.supports.groups = this.hasRuntimeGroupSupport();
  }

  getName(): string {
    return this.queue.name;
  }

  getType(): "bullmq" {
    return "bullmq";
  }

  async getJobCounts(): Promise<JobCounts> {
    const counts = await this.queue.getJobCounts();
    return {
      active: counts.active,
      waiting: counts.waiting,
      completed: counts.completed,
      failed: counts.failed,
      delayed: counts.delayed,
      paused: counts.paused || 0,
      prioritized: counts.prioritized || 0,
      "waiting-children": counts["waiting-children"] || 0,
    };
  }

  async isPaused(): Promise<boolean> {
    return this.queue.isPaused();
  }

  async pause(): Promise<void> {
    await this.queue.pause();
  }

  async resume(): Promise<void> {
    await this.queue.resume();
  }

  async empty(): Promise<void> {
    await this.queue.drain(true);
  }

  async clean(status: BullMQCleanableStatus, graceMs: number): Promise<void> {
    const bullmqStatus = status === "waiting" ? "wait" : status;
    await this.queue.clean(graceMs, 0, bullmqStatus);
  }

  async getRedisInfo() {
    const info = parse(await (await this.queue.client).info());
    return {
      ...info,
      maxclients: (info as unknown as Record<string, string>).maxclients || "0",
    };
  }

  async getJobs(
    status: BullMQStatus,
    start: number,
    end: number,
  ): Promise<AdaptedJob[]> {
    const jobs = await this.queue.getJobs([status], start, end);
    const adapted = jobs
      .filter((job): job is BullMQJob => job != null)
      .map((job) => this.adaptJob(job));
    const requested = end - start + 1;
    this.pageMeta.set(adapted, {
      capped: false,
      cursorAdvance: requested,
      exhausted: jobs.length < requested,
      scanned: start + jobs.length,
      scanLimit: Math.max(end + 1, 1),
    });
    return adapted;
  }

  getJobPageMeta(jobs: AdaptedJob[]): JobPageMeta | undefined {
    return this.pageMeta.get(jobs);
  }

  async getJob(jobId: string): Promise<AdaptedJob | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;
    return this.adaptJob(job);
  }

  async getJobStatus(jobId: string): Promise<BullMQStatus | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;
    const status = await job.getState();
    return this.supportsStatus(status as BullMQStatus)
      ? (status as BullMQStatus)
      : null;
  }

  async addJob(
    data: Record<string, unknown>,
    opts?: Record<string, unknown>,
  ): Promise<AdaptedJob> {
    const job = await this.queue.add("Manual add", data, opts || {});
    return this.adaptJob(job);
  }

  async removeJob(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (!job) throw new Error("Job not found");
    await job.remove();
  }

  async retryJob(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (!job) throw new Error("Job not found");
    await job.retry();
  }

  async promoteJob(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (!job) throw new Error("Job not found");
    await job.promote();
  }

  async discardJob(jobId: string): Promise<void> {
    void jobId;
    throw new Error("BullMQ does not support persistent job discarding");
  }

  async getJobLogs(jobId: string): Promise<string[] | null> {
    const { logs } = await this.queue.getJobLogs(jobId);
    return logs;
  }

  async getWorkers(): Promise<WorkerInfo[]> {
    const workers = (await this.queue.getWorkers()) as Record<string, string>[];
    return workers
      .filter(
        (worker) =>
          worker.name !== "GCP does not support client list" &&
          Boolean(worker.id || worker.rawname),
      )
      .map((worker, index) => {
        const rawName = worker.rawname;
        const configuredName = rawName?.includes(":w:")
          ? rawName.slice(rawName.indexOf(":w:") + 3)
          : undefined;

        return {
          id: worker.id || `worker-${index + 1}`,
          name: configuredName || undefined,
          ageSeconds: toNumber(worker.age),
          idleSeconds: toNumber(worker.idle),
        };
      });
  }

  async getSchedulers(): Promise<SchedulerInfo[]> {
    const schedulers = await this.queue.getJobSchedulers();
    return schedulers.map((scheduler) => ({
      key: scheduler.key,
      name: scheduler.name,
      id: scheduler.id,
      iterationCount: scheduler.iterationCount,
      limit: scheduler.limit,
      startDate: scheduler.startDate,
      endDate: scheduler.endDate,
      tz: scheduler.tz,
      pattern: scheduler.pattern,
      every: scheduler.every,
      next: scheduler.next,
      offset: scheduler.offset,
      template: scheduler.template,
    }));
  }

  async addScheduler(
    name: string,
    opts: Record<string, unknown>,
    template: Record<string, unknown>,
  ): Promise<void> {
    await this.queue.upsertJobScheduler(name, opts, template);
  }

  async updateScheduler(
    key: string,
    opts: Record<string, unknown>,
    template: Record<string, unknown>,
  ): Promise<boolean> {
    return this.withSchedulerMutationLock(key, async () => {
      const scheduler = (await this.queue.getJobSchedulers()).find(
        (candidate) => candidate.key === key,
      );
      if (!scheduler) return false;
      if (isLegacyRepeatable(scheduler)) {
        throw new UnsupportedSchedulerUpdateError(
          "Legacy BullMQ repeatable jobs cannot be updated; remove and recreate this schedule instead",
        );
      }

      await this.queue.upsertJobScheduler(key, opts, template);
      return true;
    });
  }

  async removeScheduler(key: string): Promise<void> {
    await this.withSchedulerMutationLock(key, async () => {
      const scheduler = (await this.queue.getJobSchedulers()).find(
        (candidate) => candidate.key === key,
      );
      if (scheduler && isLegacyRepeatable(scheduler)) {
        await this.queue.removeRepeatableByKey(key);
        return;
      }
      await this.queue.removeJobScheduler(key);
    });
  }

  async getMetrics(type: "completed" | "failed", start: number, end: number) {
    const metrics = await this.queue.getMetrics(type, start, end);

    // BullMQ's getMetrics returns count as the number of data points,
    // but we need the sum of jobs (completed or failed). Calculate it by summing the data array.
    const totalCount = metrics.data.reduce(
      (sum: number, count: number) => sum + count,
      0,
    );

    return {
      ...metrics,
      count: totalCount,
    };
  }

  async getGroups(): Promise<GroupInfo[]> {
    if (!this.supports.groups) {
      return [];
    }

    const queueWithGroups = this.queue as unknown as BullMQProQueueLike;
    if (!queueWithGroups.getGroups) {
      return [];
    }

    const groups = await queueWithGroups.getGroups(0, 999);
    const getGroupCount =
      queueWithGroups.getGroupJobsCount || queueWithGroups.getGroupJobCount;

    const normalizedGroups = new Map<string, GroupInfo["status"]>();
    for (const group of groups) {
      if (typeof group === "string") {
        normalizedGroups.set(group, "active");
        continue;
      }
      if (!group || typeof group !== "object" || !("id" in group)) continue;
      const { id, status } = group as { id?: unknown; status?: unknown };
      if (typeof id !== "string" || !id) continue;
      normalizedGroups.set(
        id,
        status === "paused"
          ? "paused"
          : status === "limited" ||
              status === "maxed" ||
              status === "rate-limited"
            ? "rate-limited"
            : "active",
      );
    }

    if (!getGroupCount) {
      return Array.from(normalizedGroups, ([id, status]) => ({
        id,
        count: 0,
        status,
      }));
    }

    return Promise.all(
      Array.from(normalizedGroups, async ([id, status]) => ({
        id,
        count: await getGroupCount.call(queueWithGroups, id),
        status,
      })),
    );
  }

  private adaptJob(job: BullMQJob): AdaptedJob {
    const jobName =
      job.name === "__default__"
        ? "Default"
        : this.getJobName(job.data, job.name);

    // Extract groupId from BullMQ Pro's group option if present
    const opts = job.opts as Record<string, unknown>;
    const groupId = (opts.group as { id?: string } | undefined)?.id;

    return {
      id: job.id as string,
      name: jobName,
      data: job.data,
      opts,
      createdAt: new Date(job.timestamp),
      processedAt: job.processedOn ? new Date(job.processedOn) : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
      failedReason: job.failedReason,
      stacktrace: job.stacktrace,
      retriedAt: null, // BullMQ doesn't track retry time
      returnValue: job.returnvalue,
      groupId,
      progress: typeof job.progress === "number" ? job.progress : undefined,
      attemptsMade: job.attemptsMade,
    };
  }

  private hasRuntimeGroupSupport(): boolean {
    const queueWithGroups = this.queue as unknown as BullMQProQueueLike;
    return (
      typeof queueWithGroups.getGroups === "function" &&
      (typeof queueWithGroups.getGroupJobsCount === "function" ||
        typeof queueWithGroups.getGroupJobCount === "function")
    );
  }

  private async withSchedulerMutationLock<T>(
    schedulerKey: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const client = await this.queue.client;
    const schedulerKeyHash = createHash("sha256")
      .update(schedulerKey)
      .digest("hex");
    const lockKey = this.queue.toKey(
      `queuedash:scheduler-lock:${schedulerKeyHash}`,
    );
    const token = randomUUID();
    const deadline = Date.now() + SCHEDULER_LOCK_WAIT_MS;

    while (
      (await client.set(lockKey, token, "PX", SCHEDULER_LOCK_TTL_MS, "NX")) !==
      "OK"
    ) {
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting to update the job scheduler");
      }
      await delay(SCHEDULER_LOCK_RETRY_MS);
    }

    let renewalError: unknown;
    let renewalChain = Promise.resolve();
    const renewalTimer = setInterval(() => {
      renewalChain = renewalChain.then(async () => {
        if (renewalError) return;
        try {
          const renewed = await client.eval(
            EXTEND_SCHEDULER_LOCK_SCRIPT,
            1,
            lockKey,
            token,
            SCHEDULER_LOCK_TTL_MS,
          );
          if (renewed !== 1) {
            throw new Error("Lost the job scheduler mutation lock");
          }
        } catch (error) {
          renewalError = error;
        }
      });
    }, SCHEDULER_LOCK_RENEW_MS);
    renewalTimer.unref?.();

    let result: T | undefined;
    let operationError: unknown;
    try {
      result = await operation();
    } catch (error) {
      operationError = error;
    }

    clearInterval(renewalTimer);
    await renewalChain;

    let releaseError: unknown;
    try {
      const released = await client.eval(
        RELEASE_SCHEDULER_LOCK_SCRIPT,
        1,
        lockKey,
        token,
      );
      if (released !== 1) {
        releaseError = new Error("Lost the job scheduler mutation lock");
      }
    } catch (error) {
      releaseError = error;
    }

    if (operationError) throw operationError;
    if (renewalError) throw renewalError;
    if (releaseError) throw releaseError;
    return result as T;
  }
}

const toNumber = (value: string | undefined): number | undefined => {
  const number = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
