import type Bull from "bull";
import { parse } from "redis-info";

import {
  QueueAdapter,
  type AdaptedJob,
  type JobCounts,
  type FeatureSupport,
  type JobPageMeta,
  type WorkerInfo,
} from "./base.adapter";

type BullStatus =
  | "completed"
  | "failed"
  | "delayed"
  | "active"
  | "waiting"
  | "paused";

type BullCleanableStatus = BullStatus;

export class BullAdapter extends QueueAdapter<BullStatus, BullCleanableStatus> {
  private queue: Bull.Queue;
  private pageMeta = new WeakMap<AdaptedJob[], JobPageMeta>();

  supports: FeatureSupport<BullStatus> = {
    addJobOptions: true,
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
    await this.queue.empty();
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
    const job = await this.queue.getJob(jobId);
    if (!job) return null;
    return this.adaptJob(job);
  }

  async getJobStatus(jobId: string): Promise<BullStatus | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;
    const status = await job.getState();
    return this.supportsStatus(status as BullStatus)
      ? (status as BullStatus)
      : null;
  }

  async addJob(
    data: Record<string, unknown>,
    opts?: Record<string, unknown>,
  ): Promise<AdaptedJob> {
    const job = await this.queue.add(data, opts || {});
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
    if (!(await job.isFailed())) {
      throw new Error("Job is not in failed state");
    }
    await job.retry();
  }

  async promoteJob(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (!job) throw new Error("Job not found");
    await job.promote();
  }

  async discardJob(jobId: string): Promise<void> {
    void jobId;
    throw new Error("Bull does not support persistent job discarding");
  }

  async getJobLogs(): Promise<string[] | null> {
    return null; // Bull doesn't support job logs
  }

  async getWorkers(): Promise<WorkerInfo[]> {
    const workers = await this.queue.getWorkers();
    return (workers ?? []).map((worker, index) => ({
      id: worker.id || `worker-${index + 1}`,
      ageSeconds: toNumber(worker.age),
      idleSeconds: toNumber(worker.idle),
    }));
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
    };
  }
}

const toNumber = (value: string | undefined): number | undefined => {
  const number = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(number) ? number : undefined;
};
