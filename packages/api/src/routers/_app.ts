import { jobRouter } from "./job";
import { queueRouter } from "./queue";
import { router } from "../trpc";

export const appRouter = router({
  job: jobRouter,
  queue: queueRouter,
});

export type AppRouter = typeof appRouter;
