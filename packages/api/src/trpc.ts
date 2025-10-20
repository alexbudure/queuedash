import { initTRPC } from "@trpc/server";
import type Bull from "bull";
import type BullMQ from "bullmq";
import type BeeQueue from "bee-queue";
import type { Queue as GroupMQQueue } from "groupmq";

type Queue = {
  // Display name of the queue in the UI
  displayName: string;
  // Function to get the job name from the job data
  jobName?: (data: Record<string, unknown>) => string;
} & (
  | {
      queue: Bull.Queue;
      type: "bull";
    }
  | {
      queue: BullMQ.Queue;
      type: "bullmq";
    }
  | {
      queue: BeeQueue;
      type: "bee";
    }
  | {
      queue: GroupMQQueue;
      type: "groupmq";
    }
);

export type Context = {
  // List of queues to expose
  queues: Queue[];
};

const t = initTRPC.context<Context>().create();
export const router = t.router;
export const procedure = t.procedure;
