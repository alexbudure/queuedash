import { initTRPC } from "@trpc/server";
import type Bull from "bull";
import type BullMQ from "bullmq";
import type BeeQueue from "bee-queue";
import type { Queue as GroupMQQueue } from "groupmq";
import { createAdapter } from "./queue-adapters/adapter-factory";
import type { QueueAdapter } from "./queue-adapters/base.adapter";

// User-facing API - unchanged for backward compatibility
type Queue = {
  // Display name of the queue in the UI
  displayName: string;
  // Function to get the job name from the job data
  jobName?: (data: Record<string, unknown>) => string;
} & (
  | {
      queue: Bull.Queue;
      type?: "bull";
    }
  | {
      queue: BullMQ.Queue;
      type?: "bullmq";
    }
  | {
      queue: BeeQueue;
      type?: "bee";
    }
  | {
      queue: GroupMQQueue;
      type?: "groupmq";
    }
);

export type Context = {
  // List of queues to expose
  queues: Queue[];
};

// Internal context used by routers
export type InternalContext = {
  queues: {
    adapter: QueueAdapter;
    jobName?: (data: Record<string, unknown>) => string;
  }[];
};

const t = initTRPC.context<Context>().create();
export const router = t.router;
export const procedure = t.procedure;

// Helper to transform user context to internal context
export function transformContext(ctx: Context): InternalContext {
  return {
    queues: ctx.queues.map((q) => ({
      adapter: createAdapter(q),
      jobName: q.jobName,
    })),
  };
}
