import { initTRPC, TRPCError } from "@trpc/server";
import type BeeQueue from "bee-queue";
import type Bull from "bull";
import type * as BullMQ from "bullmq";
import type { Queue as GroupMQQueue } from "groupmq";

import { resolveQueueAccess } from "./access";
import { presentErrorMessage, redactText } from "./presentation";
import {
  JobNotFoundError,
  type QueueAdapter,
  UnsupportedSchedulerUpdateError,
} from "./queue-adapters/base.adapter";
import {
  getQueueRegistry,
  type QueueRegistry,
  type QueueRegistryEntry,
} from "./queue-registry";

export type QueuedashTheme = "light" | "dark" | "system";
export type QueuedashDensity = "compact" | "comfortable";
export type QueuedashTimestampMode = "relative" | "absolute";
export type QueuedashDefaultJobStatus =
  | "remember"
  | "completed"
  | "failed"
  | "delayed"
  | "active"
  | "prioritized"
  | "waiting"
  | "waiting-children"
  | "paused";

export type QueuedashBranding = {
  // Product name shown in the UI
  name?: string;
  // Optional logo shown in place of the default Queuedash mark
  logoUrl?: string;
  // Accessible label for the custom logo (defaults to the product name)
  logoAlt?: string;
  // Optional favicon for the standalone dashboard page served by the adapters
  // (defaults to the Queuedash mark)
  faviconUrl?: string;
};

export type QueuedashUiConfig = {
  // Stable identifier used to scope browser-local preferences
  instanceId?: string;
  branding?: QueuedashBranding;
  // Let Queuedash set document.title to the current queue. Off by default:
  // when embedded in a host app, the host owns the title.
  documentTitle?: boolean;
  defaults?: {
    theme?: QueuedashTheme;
    // Default polling interval. Users can override this in their browser.
    refreshIntervalMs?: number | false;
    jobsPerPage?: 20 | 30 | 50 | 100;
    defaultJobStatus?: QueuedashDefaultJobStatus;
    density?: QueuedashDensity;
    timestamps?: QueuedashTimestampMode;
    showOverviewMetrics?: boolean;
  };
};

export type QueuedashRedactionConfig = {
  // Include Queuedash's built-in sensitive key list (enabled by default)
  includeDefaultKeys?: boolean;
  // Case-insensitive object keys to redact at any depth
  keys?: string[];
  // Dot-separated paths relative to the response object; "*" matches one part
  paths?: string[];
  // Value shown in place of redacted content
  replacement?: string;
};

export type QueuedashPrivacyConfig = {
  // `true` enables the built-in policy; an object customizes it.
  redact?: boolean | QueuedashRedactionConfig;
  // Entire response categories can be withheld before serialization.
  expose?: {
    jobData?: boolean;
    jobOptions?: boolean;
    returnValues?: boolean;
    stacktraces?: boolean;
    logs?: boolean;
    schedulerData?: boolean;
  };
};

export type QueuedashAction =
  | "queue.pause"
  | "queue.resume"
  | "queue.empty"
  | "queue.clean"
  | "queue.setConcurrency"
  | "queue.setRateLimit"
  | "queue.clearRateLimit"
  | "job.add"
  | "job.retry"
  | "job.promote"
  | "job.discard"
  | "job.rerun"
  | "job.remove"
  | "job.update"
  | "job.changeDelay"
  | "job.changePriority"
  | "job.removeDeduplication"
  | "scheduler.add"
  | "scheduler.update"
  | "scheduler.remove";

export type QueuedashAccessMode = "full" | "read-only" | "hidden";

export type QueuedashAccessRule = {
  // Exact queue names or `*` wildcard patterns. Read-only so a caller can pass
  // an `as const` list straight through; nothing here is ever mutated.
  queues: readonly string[];
  mode?: QueuedashAccessMode;
  deny?: readonly QueuedashAction[];
};

export type QueuedashAccessConfig = {
  default?: QueuedashAccessMode;
  rules?: QueuedashAccessRule[];
};

export type QueuedashSearchConfig = {
  // Hard server cap for a single bounded job search.
  maxScanned?: number;
};

export type QueuedashQueueDiscoveryConfig = {
  // Discovery is deliberately limited to queue types with stable Redis markers.
  type: "bull" | "bullmq";
  connectionUrl: string;
  // Queue key prefix. Both Bull and BullMQ default to "bull".
  prefix?: string;
  // How long a successful registry result is cached.
  refreshIntervalMs?: number;
  // Maximum number of discovered queues exposed by one registry.
  maxQueues?: number;
  // Optional server-side filters and display-name mapping.
  include?: (queueName: string) => boolean;
  displayName?: (queueName: string) => string;
};

// User-facing queue configuration.
export type QueuedashQueue = {
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
  // Statically configured queues to expose
  queues?: QueuedashQueue[];
  // Optional, explicit Redis queue discovery
  discovery?: QueuedashQueueDiscoveryConfig;
  // Optional server-provided UI configuration
  ui?: QueuedashUiConfig;
  // Server-enforced response redaction
  privacy?: QueuedashPrivacyConfig;
  // Server-enforced queue visibility and mutation policy
  access?: QueuedashAccessConfig;
  // Server-enforced search limits
  search?: QueuedashSearchConfig;
};

// Internal context used by routers
export type InternalContext = {
  queues: {
    adapter: QueueAdapter;
    jobName?: (data: Record<string, unknown>) => string;
  }[];
  privacy?: QueuedashPrivacyConfig;
  access?: QueuedashAccessConfig;
  search?: QueuedashSearchConfig;
};

const t = initTRPC.context<Context>().create();

// Adapter errors that describe the request rather than a server failure.
const getProcedureErrorCode = (error: TRPCError): TRPCError["code"] => {
  if (error.cause instanceof JobNotFoundError) return "NOT_FOUND";
  if (error.cause instanceof UnsupportedSchedulerUpdateError) {
    return "BAD_REQUEST";
  }
  return error.code;
};

// The single place a procedure's error is shaped for the client. tRPC has
// already wrapped anything a resolver threw in a TRPCError whose cause is the
// original, so procedures let adapter errors through rather than catching and
// re-wrapping them: a catch that re-wraps loses the cause, and with it both
// the code an adapter error maps to and the error a host's onError is given.
const presentProcedureErrors = t.middleware(async ({ ctx, next }) => {
  const result = await next();
  if (result.ok) return result;

  const error = result.error;
  const code = getProcedureErrorCode(error);
  const message = redactText(error.message, ctx.privacy);
  if (code === error.code && message === error.message) throw error;

  throw new TRPCError({
    code,
    message,
    // The adapter's own error rather than tRPC's wrapper around it, so a
    // host's onError still has the original error and its stack. This error's
    // own stack starts with the redacted message.
    cause: error.cause ?? error,
  });
});

export const router = t.router;
export const procedure = t.procedure.use(presentProcedureErrors);

// Every procedure call needs the queues its caller may see, and the overview
// makes one call per queue on each poll: filtering every queue on every call
// made a poll quadratic in the number of queues (about 2 s for 1,000 queues,
// blocking the host's event loop). The filtered list is kept per registry
// until its queues or the access policy change.
type VisibleQueues = {
  entries: readonly QueueRegistryEntry[];
  policy: string;
  visible: InternalContext["queues"];
};
const visibleQueuesByRegistry = new WeakMap<QueueRegistry, VisibleQueues>();

// Only the default mode and each rule's queues and mode decide visibility.
// Compared by value, not identity, so an access config edited in place still
// takes effect on the next call, as it did when nothing was kept.
const getVisibilityPolicy = (access?: QueuedashAccessConfig): string =>
  JSON.stringify([
    access?.default,
    access?.rules?.map(({ queues, mode }) => [queues, mode]),
  ]);

const getVisibleQueues = (
  registry: QueueRegistry,
  entries: readonly QueueRegistryEntry[],
  access?: QueuedashAccessConfig,
): InternalContext["queues"] => {
  const policy = getVisibilityPolicy(access);
  const cached = visibleQueuesByRegistry.get(registry);
  // The registry builds a new list on every call, from entries it keeps, so
  // an unchanged list holds the same entries in the same order.
  if (
    cached?.policy === policy &&
    (cached.entries === entries ||
      (cached.entries.length === entries.length &&
        cached.entries.every((entry, index) => entry === entries[index])))
  ) {
    return cached.visible;
  }

  const visible = entries.filter(
    ({ adapter }) =>
      resolveQueueAccess(adapter.getName(), access).mode !== "hidden",
  );
  visibleQueuesByRegistry.set(registry, { entries, policy, visible });
  return visible;
};

// Helper to transform user context to the cached internal registry.
export async function transformContext(ctx: Context): Promise<InternalContext> {
  const registry = getQueueRegistry(ctx);
  try {
    const queues = await registry.list();
    return {
      queues: getVisibleQueues(registry, queues, ctx.access),
      privacy: ctx.privacy,
      access: ctx.access,
      search: ctx.search,
    };
  } catch (error) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        presentErrorMessage(error, ctx.privacy) ??
        "Could not load the queue registry",
      cause: error,
    });
  }
}
