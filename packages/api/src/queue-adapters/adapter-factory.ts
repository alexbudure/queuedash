import type Bull from "bull";
import type { Queue as BullMQQueue } from "bullmq";
import type BeeQueue from "bee-queue";
import type { Queue as GroupMQQueue } from "groupmq";
import { BullAdapter } from "./bull.adapter";
import { BullMQAdapter } from "./bullmq.adapter";
import { BeeAdapter } from "./bee.adapter";
import { GroupMQAdapter } from "./groupmq.adapter";
import type { QueueAdapter } from "./base.adapter";

type QueueConfig = {
  queue: Bull.Queue | BullMQQueue | BeeQueue | GroupMQQueue;
  type?: "bull" | "bullmq" | "bee" | "groupmq";
  displayName: string;
  jobName?: (data: Record<string, unknown>) => string;
};

export function detectQueueType(
  queue: Bull.Queue | BullMQQueue | BeeQueue | GroupMQQueue,
): "bull" | "bullmq" | "bee" | "groupmq" {
  // GroupMQ: has queue.namespace and queue.redis and queue.getJobsByStatus
  if ("namespace" in queue && "redis" in queue && "getJobsByStatus" in queue) {
    return "groupmq";
  }

  // BullMQ: has queue.getWorkers method
  if ("getWorkers" in queue) {
    return "bullmq";
  }

  // Bee-Queue: has queue.settings.redis and queue.checkHealth
  if ("settings" in queue && "checkHealth" in queue) {
    return "bee";
  }

  // Bull: has queue.client and queue.add and queue.process but not getWorkers
  if (
    "client" in queue &&
    "add" in queue &&
    "process" in queue &&
    !("getWorkers" in queue)
  ) {
    return "bull";
  }

  throw new Error(
    "Could not detect queue type. Please specify the type explicitly.",
  );
}

export function createAdapter(config: QueueConfig): QueueAdapter {
  const detectedType = config.type || detectQueueType(config.queue);

  switch (detectedType) {
    case "bull":
      return new BullAdapter(
        config.queue as Bull.Queue,
        config.displayName,
        config.jobName,
      );
    case "bullmq":
      return new BullMQAdapter(
        config.queue as BullMQQueue,
        config.displayName,
        config.jobName,
      );
    case "bee":
      return new BeeAdapter(
        config.queue as BeeQueue,
        config.displayName,
        config.jobName,
      );
    case "groupmq":
      return new GroupMQAdapter(
        config.queue as GroupMQQueue,
        config.displayName,
        config.jobName,
      );
    default:
      throw new Error(`Unknown queue type: ${detectedType}`);
  }
}
