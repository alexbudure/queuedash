import type { Queue as BullMQQueue, Job as BullMQJob } from "bullmq";
import { parse } from "redis-info";
import {
  QueueAdapter,
  type AdaptedJob,
  type JobCounts,
  type FeatureSupport,
  type SchedulerInfo,
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

type BullMQCleanableStatus = BullMQStatus;

export class BullMQAdapter extends QueueAdapter<
  BullMQStatus,
  BullMQCleanableStatus
> {
  private queue: BullMQQueue;

  supports: FeatureSupport<BullMQStatus> = {
    pause: true,
    resume: true,
    clean: true,
    retry: true,
    promote: true,
    logs: true,
    schedulers: true,
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
  };

  constructor(
    queue: BullMQQueue,
    displayName: string,
    jobNameFn?: (data: Record<string, unknown>) => string,
  ) {
    super(displayName, jobNameFn);
    this.queue = queue;
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
    await this.queue.drain();
  }

  async clean(status: BullMQCleanableStatus, graceMs: number): Promise<void> {
    const bullmqStatus =
      status === "waiting" || status === "waiting-children" ? "wait" : status;
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
    const job = await this.queue.getJob(jobId);
    if (!job) throw new Error("Job not found");
    await job.discard();
  }

  async getJobLogs(jobId: string): Promise<string[] | null> {
    const { logs } = await this.queue.getJobLogs(jobId);
    return logs;
  }

  async getSchedulers(): Promise<SchedulerInfo[]> {
    const schedulers = await this.queue.getJobSchedulers();
    return schedulers.map((scheduler) => ({
      key: scheduler.key,
      name: scheduler.name,
      id: scheduler.id,
      endDate: scheduler.endDate,
      tz: scheduler.tz,
      pattern: scheduler.pattern,
      every: scheduler.every,
      next: scheduler.next,
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

  async removeScheduler(key: string): Promise<void> {
    await this.queue.removeJobScheduler(key);
  }

  async getMetrics(
    type: "completed" | "failed",
    start: number,
    end: number,
  ) {
    const metrics = await this.queue.getMetrics(type, start, end);
    
    // BullMQ's getMetrics returns count as the number of data points,
    // but we need the sum of jobs (completed or failed). Calculate it by summing the data array.
    const totalCount = metrics.data.reduce((sum: number, count: number) => sum + count, 0);
    
    return {
      ...metrics,
      count: totalCount,
    };
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
}
