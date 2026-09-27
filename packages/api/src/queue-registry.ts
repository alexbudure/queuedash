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
// A discovered BullMQ connection that has never been ready gives up after a
// few quick retries; see createDiscoveredQueueRetryStrategy.
const DISCOVERED_QUEUE_HANDSHAKE_RETRIES = 3;
const DISCOVERED_QUEUE_HANDSHAKE_RETRY_DELAY_MS = 200;
const DISCOVERED_QUEUE_CONNECT_TIMEOUT_MS = 3_000;

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

/**
 * ioredis retries a dropped connection forever, which is what a live queue
 * wants. Before a discovered queue's first handshake, though, it means a
 * connection that can never come up (Redis at `maxclients`, a network drop
 * right after the SCAN) never settles the handshake the registry waits on, and
 * every request waits with it. Until the first handshake succeeds the
 * connection gives up after a few quick retries, which rejects the handshake
 * on its own; after that it reconnects with BullMQ's default backoff.
 */
const createDiscoveredQueueRetryStrategy = () => {
  let handshakeSucceeded = false;
  return {
    markHandshakeSucceeded: () => {
      handshakeSucceeded = true;
    },
    retryStrategy: (attempt: number): number | null => {
      if (handshakeSucceeded) {
        return Math.max(Math.min(Math.exp(attempt), 20_000), 1_000);
      }
      return attempt > DISCOVERED_QUEUE_HANDSHAKE_RETRIES
        ? null
        : DISCOVERED_QUEUE_HANDSHAKE_RETRY_DELAY_MS;
    },
  };
};

const createDiscoveredQueue = async (
  name: string,
  discovery: QueuedashQueueDiscoveryConfig,
): Promise<QueuedashQueue> => {
  const prefix = discovery.prefix ?? "bull";
  const displayName = discovery.displayName?.(name) ?? name;

  if (discovery.type === "bullmq") {
    const { Queue: BullMQQueue } = await import("bullmq");
    const retry = createDiscoveredQueueRetryStrategy();
    const queue = new BullMQQueue(name, {
      connection: {
        url: discovery.connectionUrl,
        connectTimeout: DISCOVERED_QUEUE_CONNECT_TIMEOUT_MS,
        retryStrategy: retry.retryStrategy,
      },
      prefix,
      // The queue belongs to another application. Left to its default,
      // BullMQ's constructor rewrites that application's queue meta with this
      // process's defaults: its events stream cap and its library version.
      skipMetasUpdate: true,
    });
    // A handshake that gives up rejects here as well as for the registry,
    // which settles it separately, so this copy needs its own handler.
    void queue.waitUntilReady().then(retry.markHandshakeSucceeded, () => {});
    return { queue, displayName, type: "bullmq" };
  }

  const { default: Bull } = await import("bull");
  return {
    queue: new Bull(name, discovery.connectionUrl, {
      prefix,
      // Bull takes the host, port and credentials from the URL but ignores
      // its scheme, so a `rediss://` URL would otherwise connect without TLS.
      ...(/^rediss:/i.test(discovery.connectionUrl) && {
        redis: { tls: {} },
      }),
    }),
    displayName,
    type: "bull",
  };
};

/**
 * BullMQ removes its connection's own event listeners while closing, but a
 * close that lands mid-handshake abandons the initialization rather than
 * awaiting it. The abandoned handshake then rejects into a connection that no
 * longer has an `error` listener, and BullMQ rethrows that rejection out of a
 * promise nobody holds, which surfaces as an unhandled rejection. Discovered
 * connections belong to the registry, so wait for the handshake before taking
 * ownership; every later close then takes BullMQ's graceful QUIT path. The
 * wait ends because the connection gives up a handshake that cannot succeed,
 * not because of a timeout, which would close it mid-handshake after all.
 */
const waitForQueueHandshake = async (queue: QueuedashQueue): Promise<void> => {
  const waitUntilReady = (
    queue.queue as unknown as {
      waitUntilReady?: () => Promise<unknown>;
    }
  ).waitUntilReady;
  if (typeof waitUntilReady !== "function") return;

  await waitUntilReady.call(queue.queue);
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
  private readonly discovery?: QueuedashQueueDiscoveryConfig;
  private readonly entries = new WeakMap<QueuedashQueue, QueueRegistryEntry>();
  private readonly entriesByQueue = new WeakMap<object, QueueRegistryEntry>();
  private discoveredQueues = new Map<string, QueuedashQueue>();
  private pendingCleanupQueues = new Set<QueuedashQueue>();
  private lastRefreshAt = 0;
  private refreshPromise?: Promise<void>;
  private lastAttemptAt?: number;
  private lastError?: unknown;
  private lastErrorAt?: number;
  private lastSuccessfulRefreshAt?: number;
  private truncated = false;
  private scanCursor = "0";
  private scanQueueNames = new Set<string>();
  private scanOverflow = false;
  private closePromise?: Promise<void>;
  private closing = false;

  constructor(ctx: Context) {
    this.ctx = ctx;
    this.discovery = ctx.discovery;
  }

  // Read on every use rather than captured once: the registry outlives the
  // request that created it, and a host may reassign ctx.queues after
  // mounting, as the per-request contexts of v3 allowed.
  private get staticQueues(): QueuedashQueue[] {
    return this.ctx.queues ?? [];
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
        // A refresh may still be connecting queues, including one running in
        // the background. They are only closeable once it has settled; it
        // never rejects, since failures are recorded in discovery status.
        await this.refreshPromise;

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
        this.scanCursor = "0";
        this.scanQueueNames.clear();
        this.scanOverflow = false;

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
    const cached = this.entries.get(queue);
    if (cached) return cached;

    // A rebuilt ctx.queues array brings new config objects around the same
    // queue instances. Their adapters are reused, so concurrent health reads,
    // which are de-duplicated per adapter, still share one Redis round trip,
    // unless the presentation the adapter was built with has changed.
    const previous = this.entriesByQueue.get(queue.queue);
    const entry =
      previous &&
      previous.jobName === queue.jobName &&
      previous.adapter.getDisplayName() === queue.displayName
        ? previous
        : { adapter: createAdapter(queue), jobName: queue.jobName };
    this.entries.set(queue, entry);
    this.entriesByQueue.set(queue.queue, entry);
    return entry;
  }

  private async refreshDiscoveredQueues(): Promise<void> {
    const discovery = this.discovery;
    if (!discovery) return;

    const refreshIntervalMs = normalizeDiscoveryRefreshInterval(
      discovery.refreshIntervalMs,
    );
    if (
      !this.refreshPromise &&
      Date.now() - this.lastRefreshAt >= refreshIntervalMs
    ) {
      this.refreshPromise = this.discover(discovery)
        .catch((error: unknown) => {
          // Keep the last known-good registry during a temporary Redis outage,
          // report it through discovery status, and wait a full interval
          // before trying again.
          this.lastError = error;
          this.lastErrorAt = Date.now();
          this.lastRefreshAt = this.lastErrorAt;
        })
        .finally(() => {
          this.refreshPromise = undefined;
        });
    }

    // Once a discovery has succeeded, requests are served its result while a
    // due refresh runs in the background. A refresh sweeps the keyspace and
    // connects every new queue, which no request should wait for, least of
    // all one for a static queue.
    if (this.lastSuccessfulRefreshAt !== undefined) return;

    // Until then only static queues could be served, so the first discovery
    // is awaited. Discovered connections give up a handshake that cannot
    // succeed (see createDiscoveredQueueRetryStrategy), which bounds this.
    await this.refreshPromise;
    if (this.lastError !== undefined && this.staticQueues.length === 0) {
      throw this.lastError;
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
    const queueNames = new Set(this.scanQueueNames);
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
    let eligibleQueueOverflow = this.scanOverflow;
    let cursor = this.scanCursor;

    client.on("error", () => {
      // Connection errors are surfaced by connect/scan. The listener prevents
      // Redis EventEmitter errors from becoming uncaught exceptions.
    });

    try {
      await client.connect();

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

        if (iterations >= MAX_DISCOVERY_SCAN_ITERATIONS && cursor !== "0") {
          scanWorkTruncated = true;
          break;
        }
      } while (cursor !== "0");
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
    // Candidates are selected first and their handshakes are all started
    // before any is awaited: awaiting each in turn would cost one Redis round
    // trip per queue, end to end, on the request that triggered the refresh.
    const selected: Array<{
      queueName: string;
      queue: QueuedashQueue;
      ready?: Promise<void>;
    }> = [];
    let queueCapReached = eligibleQueueOverflow;
    for (const queueName of candidateNames) {
      if (selected.length >= maxQueues) {
        queueCapReached = true;
        break;
      }
      const existing = this.discoveredQueues.get(queueName);
      if (existing) {
        selected.push({ queueName, queue: existing });
        continue;
      }
      let discovered: QueuedashQueue;
      try {
        discovered = await createDiscoveredQueue(queueName, discovery);
      } catch {
        // A stale or adapter-invalid marker must not hide healthy queues, and
        // nothing was constructed, so it does not consume a slot either.
        continue;
      }
      const ready = waitForQueueHandshake(discovered);
      // Hold a handler from the moment the handshake starts. Awaiting it only
      // in the next loop would leave a window in which its rejection is
      // unhandled - the very failure this wait exists to prevent.
      void ready.catch(() => {});
      selected.push({ queueName, queue: discovered, ready });
    }

    const next = new Map<string, QueuedashQueue>();
    for (const { queueName, queue, ready } of selected) {
      if (ready) {
        try {
          await ready;
        } catch {
          // A queue whose connection never came up is still the registry's to
          // close, and its handshake has settled, so cleanup is safe now.
          this.pendingCleanupQueues.add(queue);
          continue;
        }
      }
      next.set(queueName, queue);
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
    // Continue a bounded sweep on the next refresh. Only a completed sweep
    // may evict queues that were not seen, and failed scans retain their cursor.
    this.scanCursor = cursor;
    this.scanQueueNames = cursor === "0" ? new Set() : queueNames;
    this.scanOverflow = cursor !== "0" && eligibleQueueOverflow;
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
