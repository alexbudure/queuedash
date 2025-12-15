import type BeeQueue from "bee-queue";
import { createClient } from "redis";
import {
  QueueAdapter,
  type AdaptedJob,
  type JobCounts,
  type FeatureSupport,
} from "./base.adapter";

type BeeStatus = "waiting" | "active" | "completed" | "failed" | "delayed";

type BeeCleanableStatus = never;

export class BeeAdapter extends QueueAdapter<BeeStatus, BeeCleanableStatus> {
  private queue: BeeQueue;

  supports: FeatureSupport<BeeStatus> = {
    pause: false,
    resume: false,
    clean: false,
    retry: false,
    promote: false,
    logs: false,
    schedulers: false,
    flows: false,
    priorities: false,
    empty: false,
    metrics: false,
    statuses: ["waiting", "active", "completed", "failed", "delayed"],
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
  ): Promise<AdaptedJob[]> {
    type BeeQueueStatus =
      | "waiting"
      | "active"
      | "succeeded"
      | "failed"
      | "delayed";
    const normalizedStatus: BeeQueueStatus =
      status === "completed" ? "succeeded" : (status as BeeQueueStatus);
    const client = createClient(this.queue.settings.redis);

    const [jobs] = await Promise.all([
      this.queue.getJobs(normalizedStatus, {
        start,
        end,
        size: end - start + 1,
      }),
      client.connect(),
    ]);

    await client.disconnect();

    return jobs.map((job) => this.adaptJob(job));
  }

  async getJob(jobId: string): Promise<AdaptedJob | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;
    return this.adaptJob(job);
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
    // Bee-Queue doesn't have discard, just remove
    await this.removeJob(jobId);
  }

  async getJobLogs(): Promise<string[] | null> {
    return null; // Bee-Queue doesn't support job logs
  }

  private adaptJob(job: BeeQueue.Job<Record<string, unknown>>): AdaptedJob {
    const jobName =
      job.id === "__default__" ? "Default" : this.getJobName(job.data, job.id);

    return {
      id: job.id as string,
      name: jobName,
      data: job.data,
      opts: job.options as Record<string, unknown>,
      createdAt: new Date(),
      processedAt: new Date(),
      finishedAt: new Date(),
      failedReason: "",
      stacktrace: [],
      retriedAt: new Date(),
      returnValue: undefined, // Bee-Queue doesn't support return values
    };
  }
}
