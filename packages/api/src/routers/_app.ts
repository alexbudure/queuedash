import { jobRouter } from "./job";
import { queueRouter } from "./queue";
export type { Context } from "../trpc";
import { router } from "../trpc";

export const appRouter = router({
  job: jobRouter,
  queue: queueRouter,
});

export type AppRouter = typeof appRouter;
