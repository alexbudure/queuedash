import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisMocks = vi.hoisted(() => {
  const connect = vi.fn();
  const disconnect = vi.fn();
  const client = {
    connect,
    disconnect,
    isOpen: false,
    on: vi.fn(),
    scanIterator: vi.fn(),
  };

  return {
    client,
    connect,
    createClient: vi.fn(() => client),
  };
});

vi.mock("redis", () => ({
  createClient: redisMocks.createClient,
}));

import { QueueRegistry } from "../queue-registry";

describe("queue registry discovery failures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    redisMocks.connect.mockReset();
    redisMocks.connect.mockRejectedValue(new Error("Redis unavailable"));
    redisMocks.createClient.mockClear();
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
});
