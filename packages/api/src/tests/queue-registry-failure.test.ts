import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  };
});

vi.mock("redis", () => ({
  createClient: redisMocks.createClient,
}));

vi.mock("bullmq", () => ({
  Queue: class {
    name: string;

    constructor(name: string) {
      this.name = name;
    }

    async close() {
      await redisMocks.queueClose();
    }

    async disconnect() {
      await redisMocks.queueDisconnect();
    }
  },
}));

import { QueueRegistry } from "../queue-registry";

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
    redisMocks.scan.mockImplementation(async (cursor: number) => ({
      cursor: cursor + 1,
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
      .mockResolvedValueOnce({ cursor: 1, keys: ["bull:zeta:meta"] })
      .mockResolvedValueOnce({ cursor: 0, keys: ["bull:alpha:meta"] });
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
      .mockResolvedValueOnce({ cursor: 1, keys: ["bull:alpha:meta"] })
      .mockResolvedValueOnce({ cursor: 0, keys: ["bull:zeta:meta"] });

    expect(
      (await registry.list()).map(({ adapter }) => adapter.getName()),
    ).toEqual(["alpha"]);
    await registry.close();
  });

  it("does not report truncation at an exact discovery cap", async () => {
    redisMocks.connect.mockReset();
    redisMocks.connect.mockResolvedValue(undefined);
    redisMocks.scan.mockResolvedValueOnce({
      cursor: 0,
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
        cursor: 0,
        keys: ["bull:evicted:meta"],
      })
      .mockResolvedValueOnce({ cursor: 0, keys: [] });
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
    await expect(registry.list()).resolves.toEqual([]);
    expect(redisMocks.queueClose).toHaveBeenCalledOnce();
    expect(redisMocks.queueDisconnect).toHaveBeenCalledOnce();

    await expect(registry.close()).resolves.toBeUndefined();
    expect(redisMocks.queueClose).toHaveBeenCalledTimes(2);
  });

  it("waits for an in-flight refresh before closing discovered queues", async () => {
    redisMocks.connect.mockReset();
    redisMocks.connect.mockResolvedValue(undefined);
    let resolveScan:
      | ((page: { cursor: number; keys: string[] }) => void)
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
    resolveScan?.({ cursor: 0, keys: ["bull:slow-queue:meta"] });

    await expect(listPromise).resolves.toHaveLength(1);
    await closePromise;
    expect(redisMocks.queueClose).toHaveBeenCalledOnce();
    await expect(registry.list()).rejects.toThrow("registry is closed");
  });

  it("surfaces shutdown failures and allows cleanup to be retried", async () => {
    redisMocks.connect.mockReset();
    redisMocks.connect.mockResolvedValue(undefined);
    redisMocks.scan.mockResolvedValueOnce({
      cursor: 0,
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
});
