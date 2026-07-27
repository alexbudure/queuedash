import { createClient } from "redis";

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
const SCAN_COUNT = 250;

const registryCache = new WeakMap<object, QueueRegistry>();

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const escapeRedisGlob = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("*", "\\*").replaceAll("?", "\\?");

export const getQueueNameFromMarker = (
  key: string,
  prefix: string,
): string | null => {
  const start = `${prefix}:`;
  const suffix = ":meta";
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

const closeQueue = async (queue: QueuedashQueue): Promise<void> => {
  try {
    await queue.queue.close();
  } catch {
    // A stale discovered queue should not make registry refresh fail.
  }
};

export class QueueRegistry {
  private readonly staticQueues: QueuedashQueue[];
  private readonly discovery?: QueuedashQueueDiscoveryConfig;
  private readonly entries = new WeakMap<object, QueueRegistryEntry>();
  private discoveredQueues = new Map<string, QueuedashQueue>();
  private lastRefreshAt = 0;
  private refreshPromise?: Promise<void>;
  private lastAttemptAt?: number;
  private lastErrorAt?: number;
  private lastSuccessfulRefreshAt?: number;
  private truncated = false;

  constructor(ctx: Context) {
    this.staticQueues = ctx.queues ?? [];
    this.discovery = ctx.discovery;
  }

  async list(): Promise<QueueRegistryEntry[]> {
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
    await Promise.all(
      Array.from(this.discoveredQueues.values()).map((queue) =>
        closeQueue(queue),
      ),
    );
    this.discoveredQueues.clear();
    this.lastRefreshAt = 0;
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

    const refreshIntervalMs = Math.max(
      discovery.refreshIntervalMs ?? DEFAULT_DISCOVERY_REFRESH_INTERVAL_MS,
      MIN_DISCOVERY_REFRESH_INTERVAL_MS,
    );
    if (Date.now() - this.lastRefreshAt < refreshIntervalMs) return;

    if (!this.refreshPromise) {
      this.refreshPromise = this.discover(discovery)
        .catch((error) => {
          this.lastErrorAt = Date.now();
          throw error;
        })
        .finally(() => {
          this.refreshPromise = undefined;
        });
    }

    try {
      await this.refreshPromise;
    } catch (error) {
      if (this.discoveredQueues.size === 0) throw error;
      // Keep the last known-good registry during a temporary Redis outage.
      this.lastRefreshAt = Date.now();
    }
  }

  private async discover(
    discovery: QueuedashQueueDiscoveryConfig,
  ): Promise<void> {
    this.lastAttemptAt = Date.now();
    const client = createClient({ url: discovery.connectionUrl });
    const prefix = discovery.prefix ?? "bull";
    const maxQueues = clamp(
      discovery.maxQueues ?? DEFAULT_MAX_DISCOVERED_QUEUES,
      1,
      MAX_DISCOVERED_QUEUES,
    );
    const queueNames = new Set<string>();

    client.on("error", () => {
      // Connection errors are surfaced by connect/scan. The listener prevents
      // Redis EventEmitter errors from becoming uncaught exceptions.
    });

    try {
      await client.connect();

      for await (const key of client.scanIterator({
        MATCH: `${escapeRedisGlob(prefix)}:*:meta`,
        COUNT: SCAN_COUNT,
      })) {
        const queueName = getQueueNameFromMarker(key, prefix);
        if (!queueName || discovery.include?.(queueName) === false) continue;

        queueNames.add(queueName);
        if (queueNames.size >= maxQueues) break;
      }
    } finally {
      if (client.isOpen) {
        await client.disconnect();
      }
    }

    const next = new Map<string, QueuedashQueue>();
    const staticQueueNames = new Set(
      this.staticQueues.map((queue) => queue.queue.name),
    );
    for (const queueName of Array.from(queueNames).sort()) {
      if (staticQueueNames.has(queueName)) continue;

      next.set(
        queueName,
        this.discoveredQueues.get(queueName) ??
          (await createDiscoveredQueue(queueName, discovery)),
      );
    }

    await Promise.all(
      Array.from(this.discoveredQueues.entries())
        .filter(([queueName]) => !next.has(queueName))
        .map(([, queue]) => closeQueue(queue)),
    );

    this.discoveredQueues = next;
    this.lastRefreshAt = Date.now();
    this.lastSuccessfulRefreshAt = this.lastRefreshAt;
    this.truncated = queueNames.size >= maxQueues;
  }
}

export const getQueueRegistry = (ctx: Context): QueueRegistry => {
  const key = ctx.discovery ?? ctx.queues ?? ctx;
  const cached = registryCache.get(key);
  if (cached) return cached;

  const registry = new QueueRegistry(ctx);
  registryCache.set(key, registry);
  return registry;
};
