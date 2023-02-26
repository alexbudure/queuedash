import { initTRPC } from "@trpc/server";
import type Bull from "bull";
import type BullMQ from "bullmq";
import type BeeQueue from "bee-queue";

type Queue = {
  displayName: string;
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
);

export type Context = {
  queues: Queue[];
};

const t = initTRPC.context<Context>().create();
export const router = t.router;
export const procedure = t.procedure;
