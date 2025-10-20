import type Bull from "bull";
import type BullMQ from "bullmq";
import { TRPCError } from "@trpc/server";
import type { Context } from "../trpc";
import type BeeQueue from "bee-queue";
import type { Job as GroupMQJob } from "groupmq";

type QueueDashOptions = {
  priority?: number;
  delay?: number;
  attempts?: number;
  backoff?: number;
  lifo?: boolean;
  timeout?: number;
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
  stackTraceLimit?: number;
  preventParsingData?: boolean;
  repeat?: {
    offset: number;
    tz: string;
    pattern: string;
    count: number;
  };
};

type QueueDashJob = {
  id: string;
  name: string;
  data: object;
  opts: QueueDashOptions;
  createdAt: Date;
  processedAt: Date | null;
  finishedAt: Date | null;
  failedReason?: string;
  stacktrace?: string[];
  retriedAt: Date | null;
};

export type QueueDashScheduler = {
  key: string;
  name: string;
  id?: string | null;
  iterationCount?: number;
  limit?: number;
  endDate?: number;
  tz?: string;
  pattern?: string;
  every?: number;
  next?: number;
  template?: {
    data?: Record<string, unknown>;
  };
};

export const formatJob = ({
  job,
  queueInCtx,
}: {
  job:
    | Bull.Job
    | BullMQ.Job
    | BeeQueue.Job<Record<string, unknown>>
    | GroupMQJob;
  queueInCtx: Context["queues"][0];
}): QueueDashJob => {
  // Bee-Queue job detection
  if ("status" in job) {
    return {
      id: job.id as string,
      name: queueInCtx.jobName
        ? queueInCtx.jobName(job.data)
        : job.id === "__default__"
          ? "Default"
          : job.id,
      data: job.data as object,
      opts: {},
      createdAt: new Date(),
      processedAt: new Date(),
      finishedAt: new Date(),
      failedReason: "",
      stacktrace: [""],
      retriedAt: new Date(),
    };
  }

  // Bull/BullMQ jobs
  return {
    id: job.id as string,
    name: queueInCtx.jobName
      ? queueInCtx.jobName(job.data)
      : job.name === "__default__"
        ? "Default"
        : job.name,
    data: job.data as object,
    opts: job.opts,
    createdAt: new Date(job.timestamp),
    processedAt: job.processedOn ? new Date(job.processedOn) : null,
    finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
    failedReason: job.failedReason,
    stacktrace: job.stacktrace,
    // @ts-expect-error
    retriedAt: job.retriedOn ? new Date(job.retriedOn) : null,
  } as QueueDashJob;
};

export const findQueueInCtxOrFail = ({
  queueName,
  queues,
}: {
  queueName: string;
  queues: Context["queues"];
}) => {
  const queueInCtx = queues.find((q) => q.queue.name === queueName);
  if (!queueInCtx) {
    throw new TRPCError({
      code: "NOT_FOUND",
    });
  }
  return queueInCtx;
};
