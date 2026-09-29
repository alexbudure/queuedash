import type Bull from "bull";
import { parse } from "redis-info";

import {
  QueueAdapter,
  type AdaptedJob,
  type JobCounts,
  type FeatureSupport,
  type FinishedRange,
  JobNotFoundError,
  type JobPageMeta,
  type JobTimeRange,
  pickJobOptions,
  type WorkerInfo,
} from "./base.adapter";

// Bull scores a delayed job by when it is due, times 0x1000, plus a counter
// that keeps jobs due in the same millisecond in order.
const DELAYED_SCORE_FACTOR = 0x1000;

// The Redis keys Bull keeps for a queue, which its typings leave out.
type BullQueueKeys = {
  keys: Record<"completed" | "failed" | "delayed", string>;
};

// What a rerun keeps of the original's options. A copied jobId would make Bull
// drop the rerun as a duplicate, and repeat and delay describe that job's
// schedule, not a new run.
const RERUN_OPTION_KEYS = [
  "attempts",
  "backoff",
  "lifo",
  "priority",
  "removeOnComplete",
  "removeOnFail",
  "stackTraceLimit",
  "timeout",
] as const;

type BullStatus =
  | "completed"
  | "failed"
  | "delayed"
  | "active"
  | "waiting"
  | "paused";

type BullCleanableStatus = BullStatus;

/**
 * Empties a queue the way BullMQ's drain does. Bull's own `Queue#empty` DELs
 * the `delayed` set and `meta-paused` outright: that drops every repeatable
 * job's pending iteration, and Bull only schedules the next one when the
 * current one starts, so the repeatable never fires again; and it un-pauses
 * the queue while `isPaused()` still reports true. This removes each job that
 * has not started yet instead, leaving repeatable iterations and the pause
 * state alone.
 *
 * KEYS: wait, paused, delayed, priority, limiter. ARGV[1]: the queue's key prefix.
 */
const EMPTY_QUEUE_SCRIPT = `
local rcall = redis.call
local prefix = ARGV[1]
local limiterIndexKey = KEYS[5] .. ":index"

local function isRepeatIteration(jobId)
  return string.sub(jobId, 1, 7) == "repeat:"
end

-- What Bull's removeJob script clears for a job that holds no lock.
local function removeJob(jobId)
  local jobKey = prefix .. jobId
  local debounceId = rcall("HGET", jobKey, "deid")
  if debounceId then
    rcall("DEL", prefix .. "de:" .. debounceId)
  end
  rcall("DEL", jobKey, jobKey .. ":logs")
  local limitedSetKey = rcall("HGET", limiterIndexKey, jobId)
  if limitedSetKey then
    rcall("SREM", limitedSetKey, jobId)
    rcall("HDEL", limiterIndexKey, jobId)
  end
  rcall("ZREM", KEYS[4], jobId)
end

-- Waiting and paused jobs, prioritized ones included, live in these lists.
for _, listKey in ipairs({ KEYS[1], KEYS[2] }) do
  local jobIds = rcall("LRANGE", listKey, 0, -1)
  local kept = {}
  for _, jobId in ipairs(jobIds) do
    if isRepeatIteration(jobId) then
      kept[#kept + 1] = jobId
    else
      removeJob(jobId)
    end
  end
  if #kept < #jobIds then
    rcall("DEL", listKey)
    for from = 1, #kept, 7000 do
      rcall("RPUSH", listKey, unpack(kept, from, math.min(from + 6999, #kept)))
    end
  end
end

for _, jobId in ipairs(rcall("ZRANGE", KEYS[3], 0, -1)) do
  if not isRepeatIteration(jobId) then
    removeJob(jobId)
    rcall("ZREM", KEYS[3], jobId)
  end
end
`;

export class BullAdapter extends QueueAdapter<BullStatus, BullCleanableStatus> {
  private queue: Bull.Queue;
  private pageMeta = new WeakMap<AdaptedJob[], JobPageMeta>();

  supports: FeatureSupport<BullStatus> = {
    addJobOptions: true,
    jobNames: true,
    addJobOptionKeys: [
      "attempts",
      "backoff",
      "delay",
      "lifo",
      "priority",
      "removeOnComplete",
      "removeOnFail",
      "timeout",
    ],
    pause: true,
    resume: true,
    clean: {
      supportedStatuses: [
        "completed",
        "failed",
        "delayed",
        "active",
        "waiting",
        "paused",
      ],
    },
    discard: false,
    retry: true,
    promote: true,
    logs: false,
    schedulers: false,
    schedulerUpdate: false,
    flows: false,
    priorities: true,
    empty: true,
    metrics: false,
    statuses: ["completed", "failed", "delayed", "active", "waiting", "paused"],
    groups: false,
    workers: true,
    updateData: true,
    changeDelay: false,
    changePriority: false,
    deduplication: false,
    concurrencyLimit: false,
    rateLimit: false,
  };

  constructor(
    queue: Bull.Queue,
    displayName: string,
    jobNameFn?: (data: Record<string, unknown>) => string,
  ) {
    super(displayName, jobNameFn);
    this.queue = queue;
  }

  getName(): string {
    return this.queue.name;
  }

  getType(): "bull" {
    return "bull";
  }

  async getJobCounts(): Promise<JobCounts> {
    const counts = await this.queue.getJobCounts();
    return {
      active: counts.active,
      waiting: counts.waiting,
      completed: counts.completed,
      failed: counts.failed,
      delayed: counts.delayed,
      paused: (counts as { paused?: number }).paused || 0,
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
    await this.queue.client.eval(
      EMPTY_QUEUE_SCRIPT,
      5,
      this.queue.toKey("wait"),
      this.queue.toKey("paused"),
      this.queue.toKey("delayed"),
      this.queue.toKey("priority"),
      this.queue.toKey("limiter"),
      this.queue.toKey(""),
    );
  }

  async clean(status: BullCleanableStatus, graceMs: number): Promise<void> {
    type BullStatus =
      | "completed"
      | "wait"
      | "active"
      | "delayed"
      | "failed"
      | "paused";
    const bullStatus: BullStatus =
      status === "waiting" ? "wait" : (status as BullStatus);
    await this.queue.clean(graceMs, bullStatus);
  }

  async getRedisInfo() {
    const info = parse(await this.queue.client.info());
    return {
      ...info,
      maxclients: (info as unknown as Record<string, string>).maxclients || "0",
    };
  }

  async getJobs(
    status: BullStatus,
    start: number,
    end: number,
  ): Promise<AdaptedJob[]> {
    const jobs = await this.queue.getJobs([status], start, end);
    const adapted = jobs
      .filter((job): job is Bull.Job => job != null)
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

  async getJobStatus(jobId: string): Promise<BullStatus | null> {
    const job = await this.findJob(jobId);
    if (!job) return null;
    const status = await job.getState();
    return this.supportsStatus(status as BullStatus)
      ? (status as BullStatus)
      : null;
  }

  async addJob(
    data: Record<string, unknown>,
    opts?: Record<string, unknown>,
    name?: string,
  ): Promise<AdaptedJob> {
    // Unnamed, a job goes to the processor registered without a name.
    const job = name
      ? await this.queue.add(name, data, opts || {})
      : await this.queue.add(data, opts || {});
    return this.adaptJob(job);
  }

  async rerunJob(jobId: string): Promise<AdaptedJob> {
    const job = await this.findJob(jobId);
    if (!job) throw new JobNotFoundError();
    // An unnamed job's name is `__default__`, which Bull treats exactly like
    // no name, so it still reaches a processor registered without one.
    const rerun = await this.queue.add(
      job.name,
      job.data,
      pickJobOptions(job.opts as Record<string, unknown>, RERUN_OPTION_KEYS),
    );
    return this.adaptJob(rerun);
  }

  async removeJob(jobId: string): Promise<void> {
    const job = await this.findJob(jobId);
    if (!job) throw new JobNotFoundError();
    await job.remove();
  }

  async retryJob(jobId: string): Promise<void> {
    const job = await this.findJob(jobId);
    if (!job) throw new JobNotFoundError();
    if (!(await job.isFailed())) {
      throw new Error("Job is not in failed state");
    }
    await job.retry();
  }

  async promoteJob(jobId: string): Promise<void> {
    const job = await this.findJob(jobId);
    if (!job) throw new JobNotFoundError();
    await job.promote();
  }

  async discardJob(jobId: string): Promise<void> {
    void jobId;
    throw new Error("Bull does not support persistent job discarding");
  }

  async getJobLogs(): Promise<string[] | null> {
    return null; // Bull doesn't support job logs
  }

  // Completed and failed are sorted sets scored by finish time, read highest
  // first, so a time range is a run of consecutive jobs in that listing.
  async getFinishedRange(
    status: "completed" | "failed",
    { from, to }: JobTimeRange,
  ): Promise<FinishedRange | null> {
    const key = (this.queue as unknown as BullQueueKeys).keys[status];
    const min = from === undefined ? "-inf" : String(Math.floor(from));
    const max = to === undefined ? "+inf" : String(Math.floor(to));
    const results = await this.queue.client
      .multi()
      .zcount(key, to === undefined ? "+inf" : `(${max}`, "+inf")
      .zcount(key, min, max)
      .exec();
    const [above, count] = (results ?? []).map(([, value]) => Number(value));
    return { offset: to === undefined ? 0 : (above ?? 0), count: count ?? 0 };
  }

  async getRunAts(jobIds: readonly string[]): Promise<Map<string, Date>> {
    const runAts = new Map<string, Date>();
    if (jobIds.length === 0) return runAts;
    const key = (this.queue as unknown as BullQueueKeys).keys.delayed;
    const pipeline = this.queue.client.pipeline();
    for (const jobId of jobIds) pipeline.zscore(key, jobId);
    const results = (await pipeline.exec()) ?? [];
    jobIds.forEach((jobId, index) => {
      const score = results[index]?.[1];
      if (score === null || score === undefined) return;
      const dueAt = Math.floor(Number(score) / DELAYED_SCORE_FACTOR);
      if (Number.isFinite(dueAt)) runAts.set(jobId, new Date(dueAt));
    });
    return runAts;
  }

  async updateJobData(
    jobId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const job = await this.findJob(jobId);
    if (!job) throw new JobNotFoundError();
    await job.update(data);
  }

  async getWorkers(): Promise<WorkerInfo[] | null> {
    const workers = await this.queue.getWorkers();
    // Bull resolves nothing, rather than failing, when this Redis has no
    // CLIENT command: that is "cannot tell", not "no workers are running".
    if (!workers) return null;
    return workers.map((worker, index) => ({
      id: worker.id || `worker-${index + 1}`,
      ageSeconds: toNumber(worker.age),
      idleSeconds: toNumber(worker.idle),
    }));
  }

  /**
   * `queue.getJob` reads whatever key the id names. "meta" or
   * "metrics:completed" come back as a phantom job built from the queue's own
   * hash, which `job.remove()` would then delete; "failed" or "id" fail with
   * WRONGTYPE. Every real job hash has a numeric `timestamp`; those do not.
   */
  private async findJob(jobId: string): Promise<Bull.Job | null> {
    let job: Bull.Job | null;
    try {
      job = await this.queue.getJob(jobId);
    } catch (error) {
      if (isWrongTypeError(error)) return null;
      throw error;
    }
    return job && Number.isFinite(job.timestamp) ? job : null;
  }

  private adaptJob(job: Bull.Job): AdaptedJob {
    const jobName =
      job.name === "__default__"
        ? "Default"
        : this.getJobName(job.data, job.name);

    const jobWithRetry = job as Bull.Job & { retriedOn?: number };
    const progressRaw =
      typeof job.progress === "function"
        ? job.progress()
        : (job as Bull.Job & { progress?: unknown }).progress;
    const progress = typeof progressRaw === "number" ? progressRaw : undefined;

    return {
      id: job.id as string,
      name: jobName,
      data: job.data,
      opts: job.opts as Record<string, unknown>,
      createdAt: new Date(job.timestamp),
      processedAt: job.processedOn ? new Date(job.processedOn) : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
      failedReason: job.failedReason,
      stacktrace: job.stacktrace,
      retriedAt: jobWithRetry.retriedOn
        ? new Date(jobWithRetry.retriedOn)
        : null,
      returnValue: job.returnvalue,
      progress,
      attemptsMade: job.attemptsMade,
      rawName: job.name,
    };
  }
}

const toNumber = (value: string | undefined): number | undefined => {
  const number = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const isWrongTypeError = (error: unknown): boolean =>
  error instanceof Error && /\bWRONGTYPE\b/.test(error.message);
