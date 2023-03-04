import { jobRouter } from "./job";
import { queueRouter } from "./queue";
export type { Context } from "../trpc";
import { router } from "../trpc";

export const queueDashRouter = router({
  job: jobRouter,
  queue: queueRouter,
});

export type QueueDashRouter = typeof queueDashRouter;
