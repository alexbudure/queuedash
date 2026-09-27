import { createHash, randomUUID } from "node:crypto";

import type {
  Queue as BullMQQueue,
  Job as BullMQJob,
  JobType as BullMQJobType,
} from "bullmq";
import { parse } from "redis-info";

import {
  QueueAdapter,
  type AdaptedJob,
  type JobCounts,
  type FeatureSupport,
  type GroupInfo,
  JobNotFoundError,
  type JobPageMeta,
  type QueueMetrics,
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

// Named, not left to BullMQ's defaults: 6 omits "paused" from those.
const JOB_COUNT_TYPES = [
  "active",
  "completed",
  "delayed",
  "failed",
  "paused",
  "prioritized",
  "waiting",
  "waiting-children",
] as BullMQJobType[];

const MINUTE_MS = 60_000;
// BullMQ's longest metrics preset (MetricsTime.ONE_MONTH). A longer window has
// no history to show and would only allocate a long run of zeros.
const MAX_METRICS_WINDOW_MINUTES = 80_640;

const SCHEDULER_LOCK_TTL_MS = 30_000;
const SCHEDULER_LOCK_RENEW_MS = Math.floor(SCHEDULER_LOCK_TTL_MS / 3);
const SCHEDULER_LOCK_WAIT_MS = 5_000;
const SCHEDULER_LOCK_RETRY_MS = 25;
// Named commands rather than EVAL calls: it is the one way to run Lua that
// every Redis client BullMQ supports (ioredis, node-redis, Bun, Glide) shares.
const SCHEDULER_LOCK_COMMANDS = {
  queuedashAcquireSchedulerLock: `
if redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2], "NX") then
  return 1
end
return 0
`,
  queuedashExtendSchedulerLock: `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`,
  queuedashReleaseSchedulerLock: `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`,
} as const;

type SchedulerLockCommand = keyof typeof SCHEDULER_LOCK_COMMANDS;

/**
 * The Redis client as BullMQ hands it over. From 5.78 on, and for every client
 * 6 supports, that is BullMQ's own wrapper, which runs Lua through
 * `defineCommand` + `runCommand`. Before 5.78 it is a bare ioredis instance,
 * which defines commands the same way and exposes them as methods.
 */
type BullMQRedisClient = {
  info: () => Promise<string>;
  defineCommand: (
    name: string,
    definition: { numberOfKeys: number; lua: string },
  ) => void;
  runCommand?: (name: string, args: string[]) => Promise<unknown>;
};

/**
 * Where BullMQ 5 and 6 differ for a dashboard. 6 moved the Redis client behind
 * `getBackend()` and removed legacy repeatable jobs, so both are looked up on
 * the instance: the adapter serves whichever major the host app installed, not
 * the one this package happens to be compiled against.
 */
type BullMQQueueCompat = {
  client?: Promise<BullMQRedisClient | undefined>;
  getBackend?: () => { client?: Promise<BullMQRedisClient | undefined> };
  removeRepeatableByKey?: (key: string) => Promise<unknown>;
};

const clientsWithLockCommands = new WeakSet<BullMQRedisClient>();

const runSchedulerLockCommand = (
  client: BullMQRedisClient,
  name: SchedulerLockCommand,
  args: string[],
): Promise<unknown> => {
  if (!clientsWithLockCommands.has(client)) {
    for (const [commandName, lua] of Object.entries(SCHEDULER_LOCK_COMMANDS)) {
      client.defineCommand(commandName, { numberOfKeys: 1, lua });
    }
    clientsWithLockCommands.add(client);
  }
  if (typeof client.runCommand === "function") {
    return client.runCommand(name, args);
  }
  // ioredis flattens an array argument, the same call BullMQ's wrapper makes.
  return (
    client as unknown as Record<
      SchedulerLockCommand,
      (args: string[]) => Promise<unknown>
    >
  )[name](args);
};

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
    addJobOptionKeys: [
      "attempts",
      "backoff",
      "delay",
      "keepLogs",
      "lifo",
      "priority",
      "removeOnComplete",
      "removeOnFail",
      "sizeLimit",
      "stackTraceLimit",
    ],
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

  private get compat(): BullMQQueueCompat {
    return this.queue as unknown as BullMQQueueCompat;
  }

  /** Null when the queue is not backed by Redis, which BullMQ 6 allows. */
  private async getRedisClient(): Promise<BullMQRedisClient | null> {
    const client = await (typeof this.compat.getBackend === "function"
      ? this.compat.getBackend().client
      : this.compat.client);
    return client && typeof client.info === "function" ? client : null;
  }

  getName(): string {
    return this.queue.name;
  }

  getType(): "bullmq" {
    return "bullmq";
  }

  async getJobCounts(): Promise<JobCounts> {
    // BullMQ 6 keeps a paused queue's jobs in `wait`, but a BullMQ 5 producer
    // on the same queue still parks them in the legacy paused list. Leaving
    // that list uncounted hides the backlog, and Empty deletes it unannounced.
    const counts = await this.queue.getJobCounts(...JOB_COUNT_TYPES);
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

  async getFailedCount(): Promise<number> {
    return this.queue.getFailedCount();
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
    const client = await this.getRedisClient();
    if (!client) {
      throw new Error(
        "This BullMQ queue is not backed by Redis, so there is no server to report on",
      );
    }
    const info = parse(await client.info());
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
    // "paused" left BullMQ's job types in 6, but its scripts still read the
    // legacy list a BullMQ 5 producer can leave behind.
    const jobs = await this.queue.getJobs(
      [status as BullMQJobType],
      start,
      end,
    );
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
    const job = await this.findJob(jobId);
    if (!job) return null;
    return this.adaptJob(job);
  }

  async getJobStatus(jobId: string): Promise<BullMQStatus | null> {
    const job = await this.findJob(jobId);
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
    const job = await this.findJob(jobId);
    if (!job) throw new JobNotFoundError();
    await job.remove();
  }

  async retryJob(jobId: string): Promise<void> {
    const job = await this.findJob(jobId);
    if (!job) throw new JobNotFoundError();
    await job.retry();
  }

  async promoteJob(jobId: string): Promise<void> {
    const job = await this.findJob(jobId);
    if (!job) throw new JobNotFoundError();
    await job.promote();
  }

  async discardJob(jobId: string): Promise<void> {
    void jobId;
    throw new Error("BullMQ does not support persistent job discarding");
  }

  async getJobLogs(jobId: string): Promise<string[] | null> {
    if (!(await this.findJob(jobId))) throw new JobNotFoundError();
    const { logs } = await this.queue.getJobLogs(jobId);
    return logs;
  }

  async getWorkers(): Promise<WorkerInfo[] | null> {
    const workers = (await this.queue.getWorkers()) as Record<string, string>[];
    // Without CLIENT LIST (renamed away, or a managed Redis that refuses it)
    // BullMQ answers with a placeholder entry rather than an error. It is no
    // client, so it has no id: that is "cannot tell", not "no workers".
    if (workers.some((worker) => !worker.id)) return null;
    return workers.map((worker) => {
      const rawName = worker.rawname;
      const configuredName = rawName?.includes(":w:")
        ? rawName.slice(rawName.indexOf(":w:") + 3)
        : undefined;

      return {
        id: worker.id,
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
      const scheduler = await this.queue.getJobScheduler(key);
      // BullMQ can synthesize legacy metadata for a missing colon-delimited
      // key. A null score means there is no scheduled entry to update.
      if (!scheduler || scheduler.next === null) return false;
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
      const scheduler = await this.queue.getJobScheduler(key);
      // Only BullMQ 5 can hold, and so remove, a legacy repeatable job.
      const removeLegacy = this.compat.removeRepeatableByKey;
      if (scheduler && isLegacyRepeatable(scheduler) && removeLegacy) {
        await removeLegacy.call(this.queue, key);
        return;
      }
      await this.queue.removeJobScheduler(key);
    });
  }

  async getMetrics(
    type: "completed" | "failed",
    start: number,
    end: number,
  ): Promise<QueueMetrics> {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end <= start ||
      end - start > MAX_METRICS_WINDOW_MINUTES
    ) {
      throw new RangeError(
        `Metrics windows are whole minutes ago with 0 <= start < end, at most ${MAX_METRICS_WINDOW_MINUTES} minutes long`,
      );
    }
    const length = end - start;
    // BullMQ writes a minute's count only when a job finishes in a later
    // minute, newest first. So the list is aligned to that last write
    // (`meta.prevTS`), not to now: the last-written minute is still pending in
    // `meta.count - meta.prevCount`, and every minute since had no job
    // finish. Read enough of the list for this window and the one before it
    // (as if the last write were this minute), then shift it to now.
    const metrics = await this.queue.getMetrics(type, 0, end + length - 2);
    const { count: total, prevTS, prevCount } = metrics.meta;
    // A dashboard clock slightly behind the workers' must not shift the list.
    const idleMinutes = Math.max(
      0,
      Math.floor(Date.now() / MINUTE_MS) - Math.floor(prevTS / MINUTE_MS),
    );
    const countAt = (minutesAgo: number): number => {
      if (minutesAgo < idleMinutes) return 0;
      if (minutesAgo === idleMinutes) return total - prevCount;
      return metrics.data[minutesAgo - idleMinutes - 1] ?? 0;
    };
    // How many minutes back the history reaches: the pending minute plus the
    // list, whose length BullMQ reports as `count`. Nothing recorded, none.
    const historyMinutes = prevTS > 0 ? idleMinutes + 1 + metrics.count : 0;

    const data = Array.from({ length }, (_, index) => countAt(start + index));
    let previousCount: number | null = null;
    if (historyMinutes >= end + length) {
      previousCount = 0;
      for (let minutesAgo = end; minutesAgo < end + length; minutesAgo++) {
        previousCount += countAt(minutesAgo);
      }
    }

    return {
      data,
      count: data.reduce((sum, count) => sum + count, 0),
      previousCount,
      coveredMinutes: Math.max(0, Math.min(end, historyMinutes) - start),
      meta: metrics.meta,
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

  /**
   * `queue.getJob` reads whatever key the id names. "meta", "repeat:<scheduler
   * id>" or "metrics:completed" come back as a phantom job built from the
   * queue's own hash, which `job.remove()` would then delete: un-pausing the
   * queue and dropping its global limits, or a job scheduler. "failed" or
   * "events" fail with WRONGTYPE. Every real job hash has a numeric
   * `timestamp`; those do not.
   */
  private async findJob(jobId: string): Promise<BullMQJob | null> {
    let job: BullMQJob | undefined;
    try {
      job = await this.queue.getJob(jobId);
    } catch (error) {
      if (isWrongTypeError(error)) return null;
      throw error;
    }
    return job && Number.isFinite(job.timestamp) ? job : null;
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
      // BullMQ 6 types an unread stacktrace as null rather than an empty array.
      stacktrace: job.stacktrace ?? undefined,
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
    const client = await this.getRedisClient();
    // Without Redis there is nothing to take the lock in.
    if (!client) return operation();

    const schedulerKeyHash = createHash("sha256")
      .update(schedulerKey)
      .digest("hex");
    const lockKey = this.queue.toKey(
      `queuedash:scheduler-lock:${schedulerKeyHash}`,
    );
    const token = randomUUID();
    const deadline = Date.now() + SCHEDULER_LOCK_WAIT_MS;

    const ttl = String(SCHEDULER_LOCK_TTL_MS);

    while (
      (await runSchedulerLockCommand(client, "queuedashAcquireSchedulerLock", [
        lockKey,
        token,
        ttl,
      ])) !== 1
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
          const renewed = await runSchedulerLockCommand(
            client,
            "queuedashExtendSchedulerLock",
            [lockKey, token, ttl],
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
      const released = await runSchedulerLockCommand(
        client,
        "queuedashReleaseSchedulerLock",
        [lockKey, token],
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

const isWrongTypeError = (error: unknown): boolean =>
  error instanceof Error && /\bWRONGTYPE\b/.test(error.message);
