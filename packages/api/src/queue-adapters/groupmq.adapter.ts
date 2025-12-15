import type { Queue as GroupMQQueue, Job as GroupMQJob } from "groupmq";
import { parse } from "redis-info";
import {
  QueueAdapter,
  type AdaptedJob,
  type JobCounts,
  type FeatureSupport,
} from "./base.adapter";

type GroupMQStatus =
  | "waiting"
  | "active"
  | "completed"
  | "failed"
  | "delayed"
  | "paused"
  | "prioritized";

type GroupMQCleanableStatus = "completed" | "failed" | "delayed";

export class GroupMQAdapter extends QueueAdapter<
  GroupMQStatus,
  GroupMQCleanableStatus
> {
  private queue: GroupMQQueue;

  supports: FeatureSupport<GroupMQStatus> = {
    pause: true,
    resume: true,
    clean: {
      supportedStatuses: ["completed", "failed", "delayed"],
    },
    retry: true,
    promote: true,
    logs: false,
    schedulers: false,
    flows: false,
    priorities: true,
    empty: false,
    metrics: false,
    statuses: [
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
      "paused",
      "prioritized",
    ],
  };

  constructor(
    queue: GroupMQQueue,
    displayName: string,
    jobNameFn?: (data: Record<string, unknown>) => string,
  ) {
    super(displayName, jobNameFn);
    this.queue = queue;
  }

  getName(): string {
    return this.queue.name;
  }

  getType(): "groupmq" {
    return "groupmq";
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
    // GroupMQ doesn't have empty/drain, throw error
    throw new Error("GroupMQ does not support emptying queues");
  }

  async clean(status: GroupMQCleanableStatus, graceMs: number): Promise<void> {
    // GroupMQ's clean method: clean(graceTimeMs, limit, status)
    // limit is max number of jobs to clean - use a large number to clean all
    await this.queue.clean(graceMs, 1000, status);
  }

  async getRedisInfo() {
    const info = parse(await this.queue.redis.info());
    return {
      ...info,
      maxclients: (info as unknown as Record<string, string>).maxclients || "0",
    };
  }

  async getJobs(
    status: GroupMQStatus,
    start: number,
    end: number,
  ): Promise<AdaptedJob[]> {
    const jobs = await this.queue.getJobsByStatus([status], start, end);
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
    const job = await this.queue.add({
      groupId:
        (opts?.groupId as string) ||
        Math.random().toString(36).substring(2, 15),
      data,
      ...opts,
    });
    return this.adaptJob(job);
  }

  async removeJob(jobId: string): Promise<void> {
    await this.queue.remove(jobId);
  }

  async retryJob(jobId: string): Promise<void> {
    await this.queue.retry(jobId);
  }

  async promoteJob(jobId: string): Promise<void> {
    // GroupMQ uses queue.promote(jobId), not job.promote()
    await this.queue.promote(jobId);
  }

  async discardJob(jobId: string): Promise<void> {
    // GroupMQ doesn't have discard, just remove
    await this.removeJob(jobId);
  }

  async getJobLogs(): Promise<string[] | null> {
    return null; // GroupMQ doesn't support job logs
  }

  private adaptJob(job: GroupMQJob): AdaptedJob {
    const jobName = this.getJobName(
      job.data as Record<string, unknown>,
      job.groupId || "Default",
    );

    return {
      id: job.id,
      name: jobName,
      data: job.data,
      opts: (job.opts || {}) as Record<string, unknown>,
      createdAt: job.timestamp ? new Date(job.timestamp) : new Date(),
      processedAt: job.processedOn ? new Date(job.processedOn) : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
      failedReason: job.failedReason,
      stacktrace: Array.isArray(job.stacktrace) ? job.stacktrace : [],
      retriedAt: null,
      returnValue: job.returnvalue,
    };
  }
}
