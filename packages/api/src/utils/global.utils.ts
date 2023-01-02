import type Queue from "bull";
import { TRPCError } from "@trpc/server";
import type { Context } from "../trpc";
import Redis from "ioredis";

export const formatJob = ({
  job,
  queueInCtx,
}: {
  job: Queue.Job;
  queueInCtx: Context["queues"][0];
}) => {
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
  const queueInCtx = queues.find((q) => q.name === queueName);
  if (!queueInCtx) {
    throw new TRPCError({
      code: "NOT_FOUND",
    });
  }
  return queueInCtx;
};

const createRedisClient = () => {
  return new Redis(process.env.REDIS_URL as string, {
    tls: {},
    connectTimeout: 30000,
  });
};

const client = createRedisClient();
const subscriber = createRedisClient();

export const opts: Queue.QueueOptions = {
  createClient: function (type) {
    switch (type) {
      case "client":
        return client;
      case "subscriber":
        return subscriber;
      default:
        return createRedisClient();
    }
  },
};
