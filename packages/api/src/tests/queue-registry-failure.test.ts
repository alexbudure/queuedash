import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockBullMQOptions = {
  connection: { retryStrategy: (attempt: number) => number | null };
  skipMetasUpdate?: boolean;
};
type MockBullOptions = { prefix?: string; redis?: { tls?: object } };

const redisMocks = vi.hoisted(() => {
  const connect = vi.fn();
  const disconnect = vi.fn();
  const scan = vi.fn();
  const queueClose = vi.fn();
  const queueDisconnect = vi.fn();
  const client = {
    connect,
    disconnect,
    isOpen: false,
    on: vi.fn(),
    scan,
  };

  return {
    client,
    connect,
    queueClose,
    queueDisconnect,
    scan,
    createClient: vi.fn(() => client),
    // Queues whose first connection handshake gives up.
    failedHandshakes: new Set<string>(),
    queueOptions: new Map<string, MockBullMQOptions>(),
    bullQueues: [] as Array<{
      name: string;
      url: string;
      opts: MockBullOptions;
    }>,
  };
});

vi.mock("redis", () => ({
  createClient: redisMocks.createClient,
}));

vi.mock("bullmq", () => ({
  Queue: class {
    name: string;

    constructor(name: string, opts: MockBullMQOptions) {
      this.name = name;
      redisMocks.queueOptions.set(name, opts);
    }

    async waitUntilReady() {
      if (redisMocks.failedHandshakes.has(this.name)) {
        throw new Error("ERR max number of clients reached");
      }
    }

    async close() {
      await redisMocks.queueClose(this.name);
    }

    async disconnect() {
      await redisMocks.queueDisconnect();
    }
  },
}));

vi.mock("bull", () => ({
  default: class {
    name: string;

    constructor(name: string, url: string, opts: MockBullOptions) {
      this.name = name;
      redisMocks.bullQueues.push({ name, url, opts });
    }

    async close() {
      await redisMocks.queueClose(this.name);
    }
  },
}));

import { QueueRegistry, type QueueRegistryEntry } from "../queue-registry";

// node-redis returns SCAN cursors as strings, and the registry compares them
// against "0". Keeping the mocked pages on that contract is what proves the
// sweep terminates instead of looping on a never-matching comparison.
const nextCursor = (cursor: string): string => String(Number(cursor) + 1);

const queueNames = (entries: QueueRegistryEntry[]): string[] =>
  entries.map(({ adapter }) => adapter.getName());

// Once discovery has succeeded, list() starts a due refresh in the background
// and answers from the previous one. This waits for that refresh to settle and
// returns what the registry serves afterwards.
const listAfterRefresh = async (
  registry: QueueRegistry,
): Promise<QueueRegistryEntry[]> => {
  await registry.list();
  const { lastAttemptAt = 0 } = registry.getDiscoveryStatus();
  await vi.waitFor(() => {
    const { lastErrorAt = 0, lastSuccessfulRefreshAt = 0 } =
      registry.getDiscoveryStatus();
    expect(
      Math.max(lastErrorAt, lastSuccessfulRefreshAt),
    ).toBeGreaterThanOrEqual(lastAttemptAt);
  });
  return registry.list();
};

describe("queue registry discovery failures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    redisMocks.connect.mockReset();
    redisMocks.connect.mockRejectedValue(new Error("Redis unavailable"));
    redisMocks.createClient.mockClear();
    redisMocks.scan.mockReset();
    redisMocks.queueClose.mockReset();
    redisMocks.queueDisconnect.mockReset();
    redisMocks.failedHandshakes.clear();
    redisMocks.queueOptions.clear();
    redisMocks.bullQueues.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("backs off repeated requests after an initial discovery failure", async () => {
    const registry = new QueueRegistry({
      discovery: {
        type: "bullmq",
        connectionUrl: "redis://unavailable.example:6379",
        refreshIntervalMs: 5_000,
      },
    });

    await expect(registry.list()).rejects.toThrow("Redis unavailable");
    await expect(registry.list()).rejects.toThrow("Redis unavailable");
    expect(redisMocks.connect).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-01-01T00:00:05.001Z"));
    await expect(registry.list()).rejects.toThrow("Redis unavailable");
    expect(redisMocks.connect).toHaveBeenCalledTimes(2);
  });

  it("keeps static queues available when initial discovery fails", async () => {
    const registry = new QueueRegistry({
      queues: [
        {
          queue: { name: "static" },
          displayName: "Static",
          type: "bull",
        },
      ],
      discovery: {
        type: "bullmq",
        connectionUrl: "redis://unavailable.example:6379",
      },
    } as never);

    await expect(
      registry
        .list()
        .then((entries) => entries.map(({ adapter }) => adapter.getName())),
    ).resolves.toEqual(["static"]);
    expect(registry.getDiscoveryStatus().healthy).toBe(false);
  });

  it("bounds keyspace scan work and reports truncation", async () => {
    redisMocks.connect.mockReset();
    redisMocks.connect.mockResolvedValue(undefined);
    redisMocks.scan.mockImplementation(async (cursor: string) => ({
      cursor: nextCursor(cursor),
      keys: [],
    }));
    const registry = new QueueRegistry({
      discovery: {
        type: "bullmq",
        connectionUrl: "redis://large.example:6379",
      },
    });

    await expect(registry.list()).resolves.toEqual([]);
    expect(redisMocks.scan).toHaveBeenCalledTimes(200);
    expect(registry.getDiscoveryStatus().truncated).toBe(true);
  });

  it("selects capped queues deterministically across reordered scan pages", async () => {
    redisMocks.connect.mockReset();
    redisMocks.connect.mockResolvedValue(undefined);
    redisMocks.scan
      .mockResolvedValueOnce({ cursor: "1", keys: ["bull:zeta:meta"] })
      .mockResolvedValueOnce({ cursor: "0", keys: ["bull:alpha:meta"] });
    const registry = new QueueRegistry({
      discovery: {
        type: "bullmq",
        connectionUrl: "redis://reordered.example:6379",
        maxQueues: 1,
        refreshIntervalMs: 5_000,
      },
    });

    expect(
      (await registry.list()).map(({ adapter }) => adapter.getName()),
    ).toEqual(["alpha"]);
    expect(registry.getDiscoveryStatus().truncated).toBe(true);

    vi.advanceTimersByTime(5_001);
    redisMocks.scan
      .mockResolvedValueOnce({ cursor: "1", keys: ["bull:alpha:meta"] })
      .mockResolvedValueOnce({ cursor: "0", keys: ["bull:zeta:meta"] });

    expect(queueNames(await listAfterRefresh(registry))).toEqual(["alpha"]);
    expect(redisMocks.scan).toHaveBeenCalledTimes(4);
    await registry.close();
  });

  it("continues bounded sweeps and only evicts missing queues after a complete sweep", async () => {
    redisMocks.connect.mockResolvedValue(undefined);
    let sweep = 0;
    redisMocks.scan.mockImplementation(async (cursor: string) => {
      if (cursor === "0") sweep += 1;
      return {
        cursor: cursor === "200" ? "0" : nextCursor(cursor),
        keys:
          cursor === "0"
            ? ["bull:early:meta"]
            : cursor === "200" && sweep === 1
              ? ["bull:late:meta"]
              : [],
      };
    });
    const registry = new QueueRegistry({
      discovery: {
        type: "bullmq",
        connectionUrl: "redis://large.example:6379",
        refreshIntervalMs: 5_000,
      },
    });
    const names = async () => queueNames(await listAfterRefresh(registry));

    expect(await names()).toEqual(["early"]);
    expect(redisMocks.scan).toHaveBeenCalledTimes(200);
    expect(registry.getDiscoveryStatus().truncated).toBe(true);
    vi.advanceTimersByTime(5_001);
    expect(await names()).toEqual(["early", "late"]);
    expect(redisMocks.scan.mock.calls[200][0]).toBe("200");
    expect(redisMocks.scan).toHaveBeenCalledTimes(201);
    expect(registry.getDiscoveryStatus().truncated).toBe(false);

    vi.advanceTimersByTime(5_001);
    expect(await names()).toEqual(["early", "late"]);
    expect(redisMocks.queueClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_001);
    expect(await names()).toEqual(["early"]);
    expect(redisMocks.queueClose).toHaveBeenCalledTimes(1);
    await registry.close();
  });

  it("retains sweep progress after failures and applies the queue cap across the whole sweep", async () => {
    redisMocks.connect.mockResolvedValue(undefined);
    redisMocks.scan.mockImplementation(async (cursor: string) => ({
      cursor: nextCursor(cursor),
      keys: cursor === "0" ? ["bull:zeta:meta"] : [],
    }));
    const registry = new QueueRegistry({
      discovery: {
        type: "bullmq",
        connectionUrl: "redis://large.example:6379",
        refreshIntervalMs: 5_000,
        maxQueues: 1,
      },
    });
    const names = async () => queueNames(await listAfterRefresh(registry));
    expect(await names()).toEqual(["zeta"]);
    vi.advanceTimersByTime(5_001);
    redisMocks.scan.mockRejectedValueOnce(new Error("temporary failure"));
    expect(await names()).toEqual(["zeta"]);
    expect(registry.getDiscoveryStatus().healthy).toBe(false);
    vi.advanceTimersByTime(5_001);
    redisMocks.scan.mockResolvedValueOnce({
      cursor: "0",
      keys: ["bull:alpha:meta"],
    });
    expect(await names()).toEqual(["alpha"]);
    expect(
      redisMocks.scan.mock.calls.slice(-2).map(([cursor]) => cursor),
    ).toEqual(["200", "200"]);
    expect(registry.getDiscoveryStatus()).toMatchObject({
      healthy: true,
      truncated: true,
    });
    await registry.close();
  });

  it("does not report truncation at an exact discovery cap", async () => {
    redisMocks.connect.mockReset();
    redisMocks.connect.mockResolvedValue(undefined);
    redisMocks.scan.mockResolvedValueOnce({
      cursor: "0",
      keys: ["bull:alpha:meta"],
    });
    const registry = new QueueRegistry({
      discovery: {
        type: "bullmq",
        connectionUrl: "redis://exact-cap.example:6379",
        maxQueues: 1,
      },
    });

    await expect(registry.list()).resolves.toHaveLength(1);
    expect(registry.getDiscoveryStatus().truncated).toBe(false);
    await registry.close();
  });

  it("retains evicted queues for retry when refresh cleanup fails", async () => {
    redisMocks.connect.mockReset();
    redisMocks.connect.mockResolvedValue(undefined);
    redisMocks.scan
      .mockResolvedValueOnce({
        cursor: "0",
        keys: ["bull:evicted:meta"],
      })
      .mockResolvedValueOnce({ cursor: "0", keys: [] });
    redisMocks.queueClose.mockRejectedValueOnce(new Error("close failed"));
    redisMocks.queueDisconnect.mockRejectedValueOnce(
      new Error("disconnect failed"),
    );
    const registry = new QueueRegistry({
      discovery: {
        type: "bullmq",
        connectionUrl: "redis://refresh-cleanup.example:6379",
        refreshIntervalMs: 5_000,
      },
    });

    await expect(registry.list()).resolves.toHaveLength(1);
    vi.advanceTimersByTime(5_001);
    await expect(listAfterRefresh(registry)).resolves.toEqual([]);
    expect(redisMocks.queueClose).toHaveBeenCalledOnce();
    expect(redisMocks.queueDisconnect).toHaveBeenCalledOnce();

    await expect(registry.close()).resolves.toBeUndefined();
    expect(redisMocks.queueClose).toHaveBeenCalledTimes(2);
  });

  it("waits for an in-flight refresh before closing discovered queues", async () => {
    redisMocks.connect.mockReset();
    redisMocks.connect.mockResolvedValue(undefined);
    let resolveScan:
      | ((page: { cursor: string; keys: string[] }) => void)
      | undefined;
    redisMocks.scan.mockReturnValue(
      new Promise((resolve) => {
        resolveScan = resolve;
      }),
    );
    const registry = new QueueRegistry({
      discovery: {
        type: "bullmq",
        connectionUrl: "redis://slow.example:6379",
      },
    });

    const listPromise = registry.list();
    await vi.waitFor(() => expect(redisMocks.scan).toHaveBeenCalledOnce());
    const closePromise = registry.close();
    resolveScan?.({ cursor: "0", keys: ["bull:slow-queue:meta"] });

    await expect(listPromise).resolves.toHaveLength(1);
    await closePromise;
    expect(redisMocks.queueClose).toHaveBeenCalledOnce();
    await expect(registry.list()).rejects.toThrow("registry is closed");
  });

  it("surfaces shutdown failures and allows cleanup to be retried", async () => {
    redisMocks.connect.mockReset();
    redisMocks.connect.mockResolvedValue(undefined);
    redisMocks.scan.mockResolvedValueOnce({
      cursor: "0",
      keys: ["bull:retry-close:meta"],
    });
    redisMocks.queueClose.mockRejectedValueOnce(new Error("close failed"));
    redisMocks.queueDisconnect.mockRejectedValueOnce(
      new Error("disconnect failed"),
    );
    const registry = new QueueRegistry({
      discovery: {
        type: "bullmq",
        connectionUrl: "redis://close-failure.example:6379",
      },
    });

    await expect(registry.list()).resolves.toHaveLength(1);
    await expect(registry.close()).rejects.toThrow(
      "Could not close all Queuedash discovery connections",
    );
    expect(redisMocks.queueDisconnect).toHaveBeenCalledOnce();

    await expect(registry.list()).resolves.toHaveLength(1);
    await expect(registry.close()).resolves.toBeUndefined();
    expect(redisMocks.queueClose).toHaveBeenCalledTimes(2);
  });

  it("serves the previous discovery while a refresh is in flight", async () => {
    redisMocks.connect.mockResolvedValue(undefined);
    redisMocks.scan.mockResolvedValueOnce({
      cursor: "0",
      keys: ["bull:alpha:meta"],
    });
    const registry = new QueueRegistry({
      queues: [
        {
          queue: { name: "static" },
          displayName: "Static",
          type: "bull",
        },
      ],
      discovery: {
        type: "bullmq",
        connectionUrl: "redis://slow-refresh.example:6379",
        refreshIntervalMs: 5_000,
      },
    } as never);
    expect(queueNames(await registry.list())).toEqual(["static", "alpha"]);

    vi.advanceTimersByTime(5_001);
    const refreshedPage = Promise.withResolvers<{
      cursor: string;
      keys: string[];
    }>();
    redisMocks.scan.mockReturnValueOnce(refreshedPage.promise);
    const duringRefresh = await Promise.all([registry.list(), registry.list()]);

    expect(duringRefresh.map(queueNames)).toEqual([
      ["static", "alpha"],
      ["static", "alpha"],
    ]);
    // Both callers share the one refresh that is still waiting on Redis.
    expect(redisMocks.scan).toHaveBeenCalledTimes(2);

    refreshedPage.resolve({ cursor: "0", keys: ["bull:bravo:meta"] });
    await vi.waitFor(async () =>
      expect(queueNames(await registry.list())).toEqual(["static", "bravo"]),
    );
    expect(redisMocks.queueClose).toHaveBeenCalledWith("alpha");
    await registry.close();
  });

  it("reports a failed background refresh without failing requests", async () => {
    const unhandledRejection = vi.fn();
    process.on("unhandledRejection", unhandledRejection);
    try {
      redisMocks.connect.mockResolvedValue(undefined);
      redisMocks.scan
        .mockResolvedValueOnce({ cursor: "0", keys: ["bull:alpha:meta"] })
        .mockRejectedValueOnce(new Error("Redis unavailable"));
      const registry = new QueueRegistry({
        discovery: {
          type: "bullmq",
          connectionUrl: "redis://flaky.example:6379",
          refreshIntervalMs: 5_000,
        },
      });
      await registry.list();

      vi.advanceTimersByTime(5_001);
      expect(queueNames(await registry.list())).toEqual(["alpha"]);
      await vi.waitFor(() =>
        expect(registry.getDiscoveryStatus().healthy).toBe(false),
      );
      expect(queueNames(await registry.list())).toEqual(["alpha"]);
      await registry.close();
      expect(unhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandledRejection);
    }
  });

  it("closes queues connected by a background refresh that shutdown waited for", async () => {
    redisMocks.connect.mockResolvedValue(undefined);
    redisMocks.scan.mockResolvedValueOnce({
      cursor: "0",
      keys: ["bull:alpha:meta"],
    });
    const registry = new QueueRegistry({
      discovery: {
        type: "bullmq",
        connectionUrl: "redis://closing.example:6379",
        refreshIntervalMs: 5_000,
      },
    });
    await registry.list();

    vi.advanceTimersByTime(5_001);
    const refreshedPage = Promise.withResolvers<{
      cursor: string;
      keys: string[];
    }>();
    redisMocks.scan.mockReturnValueOnce(refreshedPage.promise);
    await registry.list();
    const closing = registry.close();
    refreshedPage.resolve({
      cursor: "0",
      keys: ["bull:alpha:meta", "bull:bravo:meta"],
    });
    await closing;

    expect(redisMocks.queueClose.mock.calls.map(([name]) => name)).toEqual([
      "alpha",
      "bravo",
    ]);
  });

  it("closes a discovered queue whose handshake gives up instead of listing it", async () => {
    redisMocks.connect.mockResolvedValue(undefined);
    redisMocks.scan.mockResolvedValueOnce({
      cursor: "0",
      keys: ["bull:healthy:meta", "bull:unreachable:meta"],
    });
    redisMocks.failedHandshakes.add("unreachable");
    const registry = new QueueRegistry({
      discovery: {
        type: "bullmq",
        connectionUrl: "redis://maxclients.example:6379",
      },
    });

    expect(queueNames(await registry.list())).toEqual(["healthy"]);
    expect(registry.getDiscoveryStatus().discoveredCount).toBe(1);
    // Its handshake has settled, so the refresh closes it straight away rather
    // than leaving it for shutdown.
    expect(redisMocks.queueClose.mock.calls).toEqual([["unreachable"]]);

    await registry.close();
    expect(redisMocks.queueClose.mock.calls).toEqual([
      ["unreachable"],
      ["healthy"],
    ]);
  });

  it("bounds only a discovered connection's first handshake", async () => {
    redisMocks.connect.mockResolvedValue(undefined);
    redisMocks.scan.mockResolvedValueOnce({
      cursor: "0",
      keys: ["bull:healthy:meta", "bull:unreachable:meta"],
    });
    redisMocks.failedHandshakes.add("unreachable");
    const registry = new QueueRegistry({
      discovery: {
        type: "bullmq",
        connectionUrl: "redis://maxclients.example:6379",
      },
    });
    await registry.list();
    const retryDelays = (queueName: string, attempts: number[]) =>
      attempts.map((attempt) =>
        redisMocks.queueOptions
          .get(queueName)
          ?.connection.retryStrategy(attempt),
      );

    // Never ready: a few quick retries, then give up so the handshake settles.
    expect(retryDelays("unreachable", [1, 2, 3, 4])).toEqual([
      200,
      200,
      200,
      null,
    ]);
    // Ready once: a later outage reconnects with BullMQ's default backoff.
    expect(retryDelays("healthy", [1, 4, 10, 50])).toEqual([
      1_000, 1_000, 20_000, 20_000,
    ]);
    expect(redisMocks.queueOptions.get("healthy")?.skipMetasUpdate).toBe(true);
    await registry.close();
  });

  it("enables TLS for Bull queues discovered through a rediss:// URL", async () => {
    redisMocks.connect.mockResolvedValue(undefined);
    redisMocks.scan.mockResolvedValue({
      cursor: "0",
      keys: ["bull:emails:id"],
    });
    const discoverBullQueue = async (connectionUrl: string) => {
      const registry = new QueueRegistry({
        discovery: { type: "bull", connectionUrl },
      });
      expect(queueNames(await registry.list())).toEqual(["emails"]);
      await registry.close();
      return redisMocks.bullQueues.at(-1);
    };

    expect(
      await discoverBullQueue("rediss://:secret@tls.example:6380/2"),
    ).toEqual({
      name: "emails",
      url: "rediss://:secret@tls.example:6380/2",
      opts: { prefix: "bull", redis: { tls: {} } },
    });
    expect(
      (await discoverBullQueue("redis://plain.example:6379"))?.opts,
    ).toEqual({ prefix: "bull" });
  });
});
