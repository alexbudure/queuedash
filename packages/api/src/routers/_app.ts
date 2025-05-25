import { jobRouter } from "./job";
import { queueRouter } from "./queue";
export type { Context } from "../trpc";
import { router } from "../trpc";
import { schedulerRouter } from "./scheduler";

export const appRouter = router({
  job: jobRouter,
  queue: queueRouter,
  scheduler: schedulerRouter,
});

export type AppRouter = typeof appRouter;
