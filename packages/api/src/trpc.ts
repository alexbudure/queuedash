import { initTRPC } from "@trpc/server";

export type Context = {
  queues: {
    name: string;
    displayName: string;
    jobName?: (data: Record<string, unknown>) => string;
  }[];
};

const t = initTRPC.context<Context>().create();
export const router = t.router;
export const procedure = t.procedure;
