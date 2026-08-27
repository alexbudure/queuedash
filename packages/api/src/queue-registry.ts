import { createClient } from "redis";

import { resolveQueueAccess } from "./access";
import { createAdapter } from "./queue-adapters/adapter-factory";
import type { QueueAdapter } from "./queue-adapters/base.adapter";
import type {
  Context,
  QueuedashQueue,
  QueuedashQueueDiscoveryConfig,
} from "./trpc";

export type QueueRegistryEntry = {
  adapter: QueueAdapter;
  jobName?: (data: Record<string, unknown>) => string;
};

export type QueueDiscoveryStatus = {
  discoveredCount: number;
  enabled: boolean;
  healthy: boolean;
  lastAttemptAt?: number;
  lastErrorAt?: number;
  lastSuccessfulRefreshAt?: number;
  truncated: boolean;
};

const DEFAULT_DISCOVERY_REFRESH_INTERVAL_MS = 30_000;
const MIN_DISCOVERY_REFRESH_INTERVAL_MS = 5_000;
const DEFAULT_MAX_DISCOVERED_QUEUES = 100;
const MAX_DISCOVERED_QUEUES = 1_000;
const SCAN_COUNT = 1_000;
const MAX_DISCOVERY_SCAN_ITERATIONS = 200;

const registryCache = new WeakMap<Context, QueueRegistry>();

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const normalizeDiscoveryRefreshInterval = (value?: number): number =>
  Math.max(
    Number.isFinite(value)
      ? (value as number)
      : DEFAULT_DISCOVERY_REFRESH_INTERVAL_MS,
    MIN_DISCOVERY_REFRESH_INTERVAL_MS,
  );

export const normalizeDiscoveryMaxQueues = (value?: number): number =>
  clamp(
    Number.isFinite(value)
      ? Math.floor(value as number)
      : DEFAULT_MAX_DISCOVERED_QUEUES,
    1,
    MAX_DISCOVERED_QUEUES,
  );

const escapeRedisGlob = (value: string): string =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll("*", "\\*")
    .replaceAll("?", "\\?")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");

const isDiscoverableQueueName = (name: string): boolean =>
  name.length > 0 && !name.includes(":");

export const getQueueNameFromMarker = (
  key: string,
  prefix: string,
  marker = "meta",
): string | null => {
  const start = `${prefix}:`;
  const suffix = `:${marker}`;
  if (!key.startsWith(start) || !key.endsWith(suffix)) return null;

  const name = key.slice(start.length, -suffix.length);
  return name.length > 0 ? name : null;
};

const createDiscoveredQueue = async (
  name: string,
  discovery: QueuedashQueueDiscoveryConfig,
): Promise<QueuedashQueue> => {
  const prefix = discovery.prefix ?? "bull";
  const displayName = discovery.displayName?.(name) ?? name;

  if (discovery.type === "bullmq") {
    const { Queue: BullMQQueue } = await import("bullmq");
    return {
      queue: new BullMQQueue(name, {
        connection: { url: discovery.connectionUrl },
        prefix,
      }),
      displayName,
      type: "bullmq",
    };
  }

  const { default: Bull } = await import("bull");
  return {
    queue: new Bull(name, discovery.connectionUrl, { prefix }),
    displayName,
    type: "bull",
  };
};

const closeQueue = async (queue: QueuedashQueue): Promise<boolean> => {
  try {
    await queue.queue.close();
    return true;
  } catch {
    const disconnect = (
      queue.queue as unknown as {
        disconnect?: () => Promise<void> | void;
      }
    ).disconnect;
    if (!disconnect) return false;

    try {
      await disconnect.call(queue.queue);
      return true;
    } catch {
      // Refresh remains available, but the registry retains ownership so a
      // later refresh or shutdown can retry this connection.
      return false;
    }
  }
};

const closeQueueForShutdown = async (queue: QueuedashQueue): Promise<void> => {
  try {
    await queue.queue.close();
    return;
  } catch (closeError) {
    const disconnect = (
      queue.queue as unknown as {
        disconnect?: () => Promise<void> | void;
      }
    ).disconnect;
    if (!disconnect) throw closeError;

    try {
      await disconnect.call(queue.queue);
    } catch (disconnectError) {
      throw new AggregateError(
        [closeError, disconnectError],
        `Could not close discovered queue "${queue.queue.name}"`,
      );
    }
  }
};

export class QueueRegistry {
  private readonly ctx: Context;
  private readonly staticQueues: QueuedashQueue[];
  private readonly discovery?: QueuedashQueueDiscoveryConfig;
  private readonly entries = new WeakMap<object, QueueRegistryEntry>();
  private discoveredQueues = new Map<string, QueuedashQueue>();
  private pendingCleanupQueues = new Set<QueuedashQueue>();
  private lastRefreshAt = 0;
  private refreshPromise?: Promise<void>;
  private lastAttemptAt?: number;
  private lastError?: unknown;
  private lastErrorAt?: number;
  private lastSuccessfulRefreshAt?: number;
  private truncated = false;
  private closePromise?: Promise<void>;
  private closing = false;

  constructor(ctx: Context) {
    this.ctx = ctx;
    this.staticQueues = ctx.queues ?? [];
    this.discovery = ctx.discovery;
  }

  async list(): Promise<QueueRegistryEntry[]> {
    if (this.closing) {
      throw new Error("Queuedash queue registry is closed");
    }

    if (this.discovery) {
      await this.refreshDiscoveredQueues();
    }

    const queues = [
      ...this.staticQueues,
      ...Array.from(this.discoveredQueues.values()),
    ];
    const seen = new Set<string>();

    return queues.flatMap((queue) => {
      const entry = this.getEntry(queue);
      const name = entry.adapter.getName();
      if (seen.has(name)) return [];
      seen.add(name);
      return [entry];
    });
  }

  async close(): Promise<void> {
    if (!this.closePromise) {
      this.closing = true;
      this.closePromise = (async () => {
        try {
          await this.refreshPromise;
        } catch {
          // Discovery failures are already reflected in registry health.
        }

        const closeResults = await Promise.allSettled(
          Array.from(
            new Set([
              ...this.discoveredQueues.values(),
              ...this.pendingCleanupQueues,
            ]),
          ).map((queue) => closeQueueForShutdown(queue)),
        );
        const closeErrors = closeResults.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (closeErrors.length > 0) {
          throw new AggregateError(
            closeErrors,
            "Could not close all Queuedash discovery connections",
          );
        }

        this.discoveredQueues.clear();
        this.pendingCleanupQueues.clear();
        this.lastRefreshAt = 0;
        this.lastAttemptAt = undefined;
        this.lastError = undefined;
        this.lastErrorAt = undefined;
        this.lastSuccessfulRefreshAt = undefined;
        this.truncated = false;

        if (registryCache.get(this.ctx) === this) {
          registryCache.delete(this.ctx);
        }
      })();
    }

    const closePromise = this.closePromise;
    try {
      await closePromise;
    } catch (error) {
      if (this.closePromise === closePromise) {
        this.closePromise = undefined;
        this.closing = false;
      }
      throw error;
    }
  }

  getDiscoveryStatus(): QueueDiscoveryStatus {
    return {
      discoveredCount: this.discoveredQueues.size,
      enabled: !!this.discovery,
      healthy:
        !this.discovery ||
        !this.lastErrorAt ||
        !!(
          this.lastSuccessfulRefreshAt &&
          this.lastSuccessfulRefreshAt >= this.lastErrorAt
        ),
      lastAttemptAt: this.lastAttemptAt,
      lastErrorAt: this.lastErrorAt,
      lastSuccessfulRefreshAt: this.lastSuccessfulRefreshAt,
      truncated: this.truncated,
    };
  }

  private getEntry(queue: QueuedashQueue): QueueRegistryEntry {
    const key = queue.queue as object;
    const cached = this.entries.get(key);
    if (cached) return cached;

    const entry = {
      adapter: createAdapter(queue),
      jobName: queue.jobName,
    };
    this.entries.set(key, entry);
    return entry;
  }

  private async refreshDiscoveredQueues(): Promise<void> {
    const discovery = this.discovery;
    if (!discovery) return;

    const refreshIntervalMs = normalizeDiscoveryRefreshInterval(
      discovery.refreshIntervalMs,
    );
    if (this.refreshPromise) {
      try {
        await this.refreshPromise;
      } catch (error) {
        if (
          this.discoveredQueues.size === 0 &&
          this.staticQueues.length === 0
        ) {
          throw error;
        }
        // Keep the last known-good registry during a temporary Redis outage.
        this.lastRefreshAt = Date.now();
      }
      return;
    }

    const refreshReferenceAt = this.lastRefreshAt || this.lastAttemptAt || 0;
    if (Date.now() - refreshReferenceAt < refreshIntervalMs) {
      if (
        this.lastError &&
        this.discoveredQueues.size === 0 &&
        this.staticQueues.length === 0
      ) {
        throw this.lastError;
      }
      return;
    }

    this.refreshPromise = this.discover(discovery)
      .catch((error) => {
        this.lastError = error;
        this.lastErrorAt = Date.now();
        throw error;
      })
      .finally(() => {
        this.refreshPromise = undefined;
      });

    try {
      await this.refreshPromise;
    } catch (error) {
      if (this.discoveredQueues.size === 0 && this.staticQueues.length === 0) {
        throw error;
      }
      // Keep the last known-good registry during a temporary Redis outage.
      this.lastRefreshAt = Date.now();
    }
  }

  private async discover(
    discovery: QueuedashQueueDiscoveryConfig,
  ): Promise<void> {
    this.lastAttemptAt = Date.now();
    const client = createClient({
      url: discovery.connectionUrl,
      socket: { reconnectStrategy: false },
    });
    const prefix = discovery.prefix ?? "bull";
    const maxQueues = normalizeDiscoveryMaxQueues(discovery.maxQueues);
    const marker = discovery.type === "bull" ? "id" : "meta";
    const queueNames = new Set<string>();
    const retainedCandidateLimit = maxQueues + 1;
    const staticQueueNames = new Set(
      this.staticQueues.map((queue) => queue.queue.name),
    );
    const isEligibleQueueName = (queueName: string): boolean =>
      isDiscoverableQueueName(queueName) &&
      !staticQueueNames.has(queueName) &&
      discovery.include?.(queueName) !== false &&
      resolveQueueAccess(queueName, this.ctx.access, this.ctx.privacy).mode !==
        "hidden";
    let scanWorkTruncated = false;
    let eligibleQueueOverflow = false;

    client.on("error", () => {
      // Connection errors are surfaced by connect/scan. The listener prevents
      // Redis EventEmitter errors from becoming uncaught exceptions.
    });

    try {
      await client.connect();

      let cursor = 0;
      let iterations = 0;
      do {
        const page = await client.scan(cursor, {
          MATCH: `${escapeRedisGlob(prefix)}:*:${marker}`,
          COUNT: SCAN_COUNT,
        });
        cursor = page.cursor;
        iterations += 1;
        const pageQueueNames = new Set<string>();

        for (const key of page.keys) {
          const queueName = getQueueNameFromMarker(key, prefix, marker);
          if (!queueName || !isEligibleQueueName(queueName)) {
            continue;
          }

          pageQueueNames.add(queueName);
        }

        const mergedQueueNames = Array.from(
          new Set([...queueNames, ...pageQueueNames]),
        ).sort();
        if (mergedQueueNames.length > retainedCandidateLimit) {
          eligibleQueueOverflow = true;
        }
        queueNames.clear();
        for (const queueName of mergedQueueNames.slice(
          0,
          retainedCandidateLimit,
        )) {
          queueNames.add(queueName);
        }

        if (iterations >= MAX_DISCOVERY_SCAN_ITERATIONS && cursor !== 0) {
          scanWorkTruncated = true;
          break;
        }
      } while (cursor !== 0);
    } finally {
      if (client.isOpen) {
        await client.disconnect();
      }
    }

    const retainedNames = scanWorkTruncated
      ? Array.from(this.discoveredQueues.keys())
          .filter(isEligibleQueueName)
          .sort()
      : [];
    const candidateNames = [
      ...retainedNames,
      ...Array.from(queueNames)
        .filter(
          (queueName) =>
            isEligibleQueueName(queueName) &&
            !retainedNames.includes(queueName),
        )
        .sort(),
    ];
    const next = new Map<string, QueuedashQueue>();
    let queueCapReached = eligibleQueueOverflow;
    for (const queueName of candidateNames) {
      if (next.size >= maxQueues) {
        queueCapReached = true;
        break;
      }
      const existing = this.discoveredQueues.get(queueName);
      if (existing) {
        next.set(queueName, existing);
        continue;
      }
      try {
        next.set(queueName, await createDiscoveredQueue(queueName, discovery));
      } catch {
        // A stale or adapter-invalid marker must not hide healthy queues.
      }
    }

    for (const [queueName, queue] of this.discoveredQueues) {
      if (!next.has(queueName)) this.pendingCleanupQueues.add(queue);
    }
    await Promise.all(
      Array.from(this.pendingCleanupQueues, async (queue) => {
        if (await closeQueue(queue)) this.pendingCleanupQueues.delete(queue);
      }),
    );

    this.discoveredQueues = next;
    this.lastRefreshAt = Date.now();
    this.lastError = undefined;
    this.lastSuccessfulRefreshAt = this.lastRefreshAt;
    this.truncated = queueCapReached || scanWorkTruncated;
  }
}

export const getQueueRegistry = (ctx: Context): QueueRegistry => {
  const cached = registryCache.get(ctx);
  if (cached) return cached;

  const registry = new QueueRegistry(ctx);
  registryCache.set(ctx, registry);
  return registry;
};

/**
 * Closes Redis clients created by queue discovery for a dashboard context.
 * User-provided static queue instances remain owned by the host application.
 */
export const closeQueuedashContext = async (ctx: Context): Promise<void> => {
  await registryCache.get(ctx)?.close();
};
