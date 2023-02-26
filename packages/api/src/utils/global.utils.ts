import type Bull from "bull";
import type BullMQ from "bullmq";
import { TRPCError } from "@trpc/server";
import type { Context } from "../trpc";
import type BeeQueue from "bee-queue";

export const formatJob = ({
  job,
  queueInCtx,
}: {
  job: Bull.Job | BullMQ.Job | BeeQueue.Job<Record<string, unknown>>;
  queueInCtx: Context["queues"][0];
}) => {
  if ("status" in job) {
    // TODO:
    return {
      id: job.id as string,
      name: queueInCtx.jobName
        ? queueInCtx.jobName(job.data)
        : job.id === "__default__"
        ? "Default"
        : job.id,
      data: job.data as object,
      opts: job.options,
      createdAt: new Date(),
      processedAt: new Date(),
      finishedAt: new Date(),
      failedReason: "",
      stacktrace: "",
      retriedAt: new Date(),
    };
  }

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
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    retriedAt: job.retriedOn ? new Date(job.retriedOn) : null,
  };
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
