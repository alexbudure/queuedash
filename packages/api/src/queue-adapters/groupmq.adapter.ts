import type { Queue as GroupMQQueue, Job as GroupMQJob } from "groupmq";
import { parse } from "redis-info";

import {
  QueueAdapter,
  type AdaptedJob,
  type JobCounts,
  type FeatureSupport,
  type GroupInfo,
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
    addJobOptions: true,
    pause: true,
    resume: true,
    clean: {
      supportedStatuses: ["completed", "failed", "delayed"],
    },
    retry: true,
    promote: true,
    logs: false,
    schedulers: false,
    schedulerUpdate: false,
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
    groups: true,
    workers: false,
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
    // GroupMQ clamps this internally; MAX_SAFE_INTEGER requests its full
    // supported clean batch instead of silently stopping after 1,000 jobs.
    await this.queue.clean(graceMs, Number.MAX_SAFE_INTEGER, status);
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
    const namespace = this.queue.namespace;
    let jobIds: string[];

    switch (status) {
      case "active":
        jobIds = await this.queue.redis.zrange(
          `${namespace}:processing`,
          start,
          end,
        );
        break;
      case "delayed":
        jobIds = await this.queue.redis.zrange(
          `${namespace}:delayed`,
          start,
          end,
        );
        break;
      case "completed":
      case "failed":
        jobIds = await this.queue.redis.zrevrange(
          `${namespace}:${status}`,
          start,
          end,
        );
        break;
      case "waiting":
        jobIds = (await this.queue.getWaitingJobs()).slice(start, end + 1);
        break;
      case "paused":
      case "prioritized":
        return [];
    }

    const jobs = await Promise.all(
      jobIds.map(async (jobId) => {
        try {
          return await this.queue.getJob(jobId);
        } catch {
          return null;
        }
      }),
    );
    return jobs
      .filter((job): job is GroupMQJob => job !== null)
      .map((job) => this.adaptJob(job));
  }

  async getJob(jobId: string): Promise<AdaptedJob | null> {
    try {
      const job = await this.queue.getJob(jobId);
      if (!job) return null;
      return this.adaptJob(job);
    } catch (error) {
      if (error instanceof Error && /not found/i.test(error.message)) {
        return null;
      }
      throw error;
    }
  }

  async getJobStatus(jobId: string): Promise<GroupMQStatus | null> {
    try {
      const job = await this.queue.getJob(jobId);
      if (!job) return null;
      const status = await job.getState();
      return this.supportsStatus(status as GroupMQStatus)
        ? (status as GroupMQStatus)
        : null;
    } catch (error) {
      if (error instanceof Error && /not found/i.test(error.message)) {
        return null;
      }
      throw error;
    }
  }

  async addJob(
    data: Record<string, unknown>,
    opts?: Record<string, unknown>,
  ): Promise<AdaptedJob> {
    const { groupId: requestedGroupId, ...jobOptions } = opts ?? {};
    delete jobOptions.data;
    const job = await this.queue.add({
      ...jobOptions,
      groupId:
        (typeof requestedGroupId === "string" && requestedGroupId) ||
        Math.random().toString(36).substring(2, 15),
      data,
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
      groupId: job.groupId,
      attemptsMade: job.attemptsMade,
    };
  }

  async getGroups(): Promise<GroupInfo[]> {
    try {
      // Use native getUniqueGroups() for better performance
      const groupIds = await this.queue.getUniqueGroups();

      // Get count for each group using native getGroupJobCount()
      const groups = await Promise.all(
        groupIds.map(async (id) => {
          const count = await this.queue.getGroupJobCount(id);
          return {
            id,
            count,
            status: "active" as const, // GroupMQ doesn't have per-group status
          };
        }),
      );

      return groups;
    } catch {
      // Fallback to manual aggregation if native methods fail
      const allStatuses: GroupMQStatus[] = [
        "waiting",
        "active",
        "completed",
        "failed",
        "delayed",
      ];

      const groupCounts = new Map<string, number>();

      for (const status of allStatuses) {
        try {
          const batchSize = 1000;
          let start = 0;

          while (true) {
            const end = start + batchSize - 1;
            const jobs = await this.queue.getJobsByStatus([status], start, end);

            if (jobs.length === 0) {
              break;
            }

            for (const job of jobs) {
              if (job.groupId) {
                groupCounts.set(
                  job.groupId,
                  (groupCounts.get(job.groupId) || 0) + 1,
                );
              }
            }

            if (jobs.length < batchSize) {
              break;
            }

            start += batchSize;
          }
        } catch {
          // Ignore errors for individual status queries
        }
      }

      return Array.from(groupCounts.entries()).map(([id, count]) => ({
        id,
        count,
        status: "active" as const,
      }));
    }
  }
}
