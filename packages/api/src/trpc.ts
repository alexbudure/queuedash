import { initTRPC, TRPCError } from "@trpc/server";
import type BeeQueue from "bee-queue";
import type Bull from "bull";
import type * as BullMQ from "bullmq";
import type { Queue as GroupMQQueue } from "groupmq";

import { resolveQueueAccess } from "./access";
import { presentErrorMessage } from "./presentation";
import type { QueueAdapter } from "./queue-adapters/base.adapter";
import { getQueueRegistry } from "./queue-registry";

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
};

export type QueuedashUiConfig = {
  // Stable identifier used to scope browser-local preferences
  instanceId?: string;
  branding?: QueuedashBranding;
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
  | "job.add"
  | "job.retry"
  | "job.promote"
  | "job.discard"
  | "job.rerun"
  | "job.remove"
  | "scheduler.add"
  | "scheduler.remove";

export type QueuedashAccessMode = "full" | "read-only" | "hidden";

export type QueuedashAccessRule = {
  // Exact queue names or `*` wildcard patterns.
  queues: string[];
  mode?: QueuedashAccessMode;
  deny?: QueuedashAction[];
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
export const router = t.router;
export const procedure = t.procedure;

// Helper to transform user context to the cached internal registry.
export async function transformContext(ctx: Context): Promise<InternalContext> {
  const registry = getQueueRegistry(ctx);
  try {
    const queues = await registry.list();
    return {
      queues: queues.filter(
        ({ adapter }) =>
          resolveQueueAccess(adapter.getName(), ctx.access).mode !== "hidden",
      ),
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
    });
  }
}
