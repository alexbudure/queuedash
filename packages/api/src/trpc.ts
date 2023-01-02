import { initTRPC } from "@trpc/server";
import type Queue from "bull";

export type Context = {
  queues: {
    name: string;
    displayName: string;
    jobName?: (data: Record<string, unknown>) => string;
  }[];
  opts: Queue.QueueOptions;
};

const t = initTRPC.context<Context>().create();
export const router = t.router;
export const procedure = t.procedure;
