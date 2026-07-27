import { jobRouter } from "./job";
import { queueRouter } from "./queue";
export type {
  Context,
  QueuedashAccessConfig,
  QueuedashAccessMode,
  QueuedashAccessRule,
  QueuedashAction,
  QueuedashBranding,
  QueuedashDefaultJobStatus,
  QueuedashDensity,
  QueuedashPrivacyConfig,
  QueuedashQueue,
  QueuedashQueueDiscoveryConfig,
  QueuedashRedactionConfig,
  QueuedashSearchConfig,
  QueuedashTheme,
  QueuedashTimestampMode,
  QueuedashUiConfig,
} from "../trpc";
import { router } from "../trpc";
import { schedulerRouter } from "./scheduler";
import { settingsRouter } from "./settings";

export const appRouter = router({
  job: jobRouter,
  queue: queueRouter,
  scheduler: schedulerRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
