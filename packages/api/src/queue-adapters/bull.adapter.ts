import type Bull from "bull";
import { parse } from "redis-info";
import {
  QueueAdapter,
  type AdaptedJob,
  type JobCounts,
  type FeatureSupport,
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

  supports: FeatureSupport<BullStatus> = {
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
    retry: true,
    promote: false,
    logs: false,
    schedulers: false,
    flows: false,
    priorities: true,
    empty: true,
    metrics: false,
    statuses: ["completed", "failed", "delayed", "active", "waiting", "paused"],
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
    return jobs.map((job) => this.adaptJob(job));
  }

  async getJob(jobId: string): Promise<AdaptedJob | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;
    return this.adaptJob(job);
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
    const job = await this.queue.getJob(jobId);
    if (!job) throw new Error("Job not found");
    await job.discard();
  }

  async getJobLogs(): Promise<string[] | null> {
    return null; // Bull doesn't support job logs
  }

  private adaptJob(job: Bull.Job): AdaptedJob {
    const jobName =
      job.name === "__default__"
        ? "Default"
        : this.getJobName(job.data, job.name);

    const jobWithRetry = job as Bull.Job & { retriedOn?: number };

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
    };
  }
}
