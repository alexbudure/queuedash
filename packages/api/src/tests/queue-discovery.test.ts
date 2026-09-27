import net, { type AddressInfo } from "node:net";

import { faker } from "@faker-js/faker";
import Bull from "bull";
import { Queue as BullMQQueue } from "bullmq";
import Redis from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getQueueRegistry,
  normalizeDiscoveryMaxQueues,
  normalizeDiscoveryRefreshInterval,
  QueueRegistry,
} from "../queue-registry";
import { appRouter } from "../routers/_app";
import type { Context } from "../trpc";
import { getBullMQRedisClient, sleep } from "./test.utils";

const queuesToClean: BullMQQueue[] = [];
const bullQueuesToClean: Bull.Queue[] = [];
const registriesToClose: QueueRegistry[] = [];

// Discovery stops a sweep after MAX_DISCOVERY_SCAN_ITERATIONS (200) pages of
// SCAN COUNT 1000, so truncating one takes more than ~200k keys, and the
// keyspace the other suites share can take several slow sweeps to cover.
// These tests use a database of their own, which one sweep covers unless a
// test fills it on purpose.
const DISCOVERY_DB = 9;
const BOUNDED_SWEEP_FILLER_KEYS = 250_000;

// A shared Redis database can require several bounded refreshes. Advance only
// the discovery clock; Redis I/O and its timers continue running normally.
// After the first discovery, list() answers from the previous refresh while
// the next one runs in the background, so each round waits for it to settle.
const discoverCompleteSweep = async (registry: QueueRegistry) => {
  let now = Date.now();
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  try {
    await registry.list();
    for (let refresh = 0; refresh < 20; refresh += 1) {
      const status = registry.getDiscoveryStatus();
      expect(status.healthy).toBe(true);
      if (!status.truncated) return await registry.list();

      now += 30_001;
      await registry.list();
      await vi.waitFor(
        () => {
          const { lastErrorAt, lastSuccessfulRefreshAt } =
            registry.getDiscoveryStatus();
          expect([lastErrorAt, lastSuccessfulRefreshAt]).toContain(now);
        },
        { timeout: 10_000 },
      );
    }
    throw new Error("Discovery did not finish a keyspace sweep");
  } finally {
    clock.mockRestore();
  }
};

afterEach(async () => {
  await Promise.all(
    registriesToClose.splice(0).map((registry) => registry.close()),
  );
  await Promise.all(
    queuesToClean.splice(0).map(async (queue) => {
      await queue.obliterate({ force: true });
      await queue.close();
    }),
  );
  await Promise.all(
    bullQueuesToClean.splice(0).map(async (queue) => {
      await queue.obliterate({ force: true });
      await queue.close();
    }),
  );
});

describe("queue discovery", () => {
  it("normalizes non-finite discovery limits", () => {
    expect(normalizeDiscoveryMaxQueues(Number.NaN)).toBe(100);
    expect(normalizeDiscoveryMaxQueues(Number.POSITIVE_INFINITY)).toBe(100);
    expect(normalizeDiscoveryRefreshInterval(Number.NaN)).toBe(30_000);
    expect(normalizeDiscoveryRefreshInterval(Number.NEGATIVE_INFINITY)).toBe(
      30_000,
    );
  });

  it("keeps static queues isolated when contexts share discovery configuration", async () => {
    const discovery = {
      type: "bullmq" as const,
      connectionUrl: `redis://127.0.0.1:6379/${DISCOVERY_DB}`,
      prefix: `queuedash-shared-discovery-${faker.string.uuid()}`,
    };
    const firstContext = {
      discovery,
      queues: [
        {
          queue: { name: "first" },
          displayName: "First",
          type: "bull" as const,
        },
      ],
    } as unknown as Context;
    const secondContext = {
      discovery,
      queues: [
        {
          queue: { name: "second" },
          displayName: "Second",
          type: "bull" as const,
        },
      ],
    } as unknown as Context;
    const firstRegistry = getQueueRegistry(firstContext);
    const secondRegistry = getQueueRegistry(secondContext);
    registriesToClose.push(firstRegistry, secondRegistry);

    const [firstEntries, secondEntries] = await Promise.all([
      firstRegistry.list(),
      secondRegistry.list(),
    ]);

    expect(firstEntries.map(({ adapter }) => adapter.getName())).toEqual([
      "first",
    ]);
    expect(secondEntries.map(({ adapter }) => adapter.getName())).toEqual([
      "second",
    ]);
  });

  it("finds BullMQ metadata with an explicit type and prefix", async () => {
    const prefix = `queuedash-discovery-${faker.string.uuid()}`;
    const queue = new BullMQQueue("emails", {
      connection: { host: "127.0.0.1", port: 6379, db: DISCOVERY_DB },
      prefix,
    });
    queuesToClean.push(queue);
    await queue.add("seed", { visible: true });

    const registry = new QueueRegistry({
      discovery: {
        type: "bullmq",
        connectionUrl: `redis://127.0.0.1:6379/${DISCOVERY_DB}`,
        prefix,
        maxQueues: 5,
      },
    });
    registriesToClose.push(registry);

    const entries = await discoverCompleteSweep(registry);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.adapter.getName()).toBe("emails");
    expect(entries[0]?.adapter.getType()).toBe("bullmq");
    await expect(entries[0]?.adapter.getJobCounts()).resolves.toBeDefined();
  });

  it("skips a marker whose queue cannot be built without hiding valid queues", async () => {
    const prefix = `queuedash-invalid-marker-${faker.string.uuid()}`;
    const queue = new BullMQQueue("emails", {
      connection: { host: "127.0.0.1", port: 6379, db: DISCOVERY_DB },
      prefix,
    });
    queuesToClean.push(queue);
    await queue.add("seed", {});
    const client = await getBullMQRedisClient(queue);
    // A valid queue name that sorts ahead of "emails": with room for one
    // queue, it would take the only slot if a failed build consumed one.
    const invalidMarker = `${prefix}:broken:meta`;
    await client.set(invalidMarker, "1");
    const displayName = vi.fn((queueName: string) => {
      if (queueName === "broken") throw new Error("No display name");
      return queueName;
    });

    try {
      const registry = new QueueRegistry({
        discovery: {
          type: "bullmq",
          connectionUrl: `redis://127.0.0.1:6379/${DISCOVERY_DB}`,
          prefix,
          maxQueues: 1,
          displayName,
        },
      });
      registriesToClose.push(registry);

      expect(
        (await discoverCompleteSweep(registry)).map(({ adapter }) =>
          adapter.getName(),
        ),
      ).toEqual(["emails"]);
      // The marker got as far as building its queue, which is where it failed.
      expect(displayName).toHaveBeenCalledWith("broken");
    } finally {
      await client.del(invalidMarker);
    }
  });

  it("filters colon-delimited markers before building a queue for them", async () => {
    const prefix = `queuedash-colon-marker-${faker.string.uuid()}`;
    const queue = new BullMQQueue("emails", {
      connection: { host: "127.0.0.1", port: 6379, db: DISCOVERY_DB },
      prefix,
    });
    queuesToClean.push(queue);
    await queue.add("seed", {});
    const client = await getBullMQRedisClient(queue);
    // BullMQ rejects colons in queue names, and the marker is ambiguous about
    // where the prefix ends, so discovery never gets as far as building one.
    const colonMarker = `${prefix}:tenant:emails:meta`;
    await client.set(colonMarker, "1");
    const displayName = vi.fn((queueName: string) => queueName);

    try {
      const registry = new QueueRegistry({
        discovery: {
          type: "bullmq",
          connectionUrl: `redis://127.0.0.1:6379/${DISCOVERY_DB}`,
          prefix,
          displayName,
        },
      });
      registriesToClose.push(registry);

      expect(
        (await discoverCompleteSweep(registry)).map(({ adapter }) =>
          adapter.getName(),
        ),
      ).toEqual(["emails"]);
      expect(displayName).not.toHaveBeenCalledWith("tenant:emails");
    } finally {
      await client.del(colonMarker);
    }
  });

  it("does not let a static queue consume the discovery cap", async () => {
    const prefix = `queuedash-static-cap-${faker.string.uuid()}`;
    const staticQueue = new BullMQQueue("static", {
      connection: { host: "127.0.0.1", port: 6379, db: DISCOVERY_DB },
      prefix,
    });
    const discoveredQueue = new BullMQQueue("discovered", {
      connection: { host: "127.0.0.1", port: 6379, db: DISCOVERY_DB },
      prefix,
    });
    queuesToClean.push(staticQueue, discoveredQueue);
    await Promise.all([
      staticQueue.add("seed", {}),
      discoveredQueue.add("seed", {}),
    ]);

    const registry = new QueueRegistry({
      queues: [
        {
          queue: staticQueue,
          displayName: "Static",
          type: "bullmq",
        },
      ],
      discovery: {
        type: "bullmq",
        connectionUrl: `redis://127.0.0.1:6379/${DISCOVERY_DB}`,
        prefix,
        maxQueues: 1,
      },
    });
    registriesToClose.push(registry);

    const names = (await discoverCompleteSweep(registry)).map(({ adapter }) =>
      adapter.getName(),
    );
    expect(names).toEqual(["static", "discovered"]);
  });

  it("finds an ordinary running Bull v4 queue from its persistent id marker", async () => {
    const prefix = `queuedash-bull-discovery-${faker.string.uuid()}`;
    const queue = new Bull("emails", `redis://127.0.0.1:6379/${DISCOVERY_DB}`, {
      prefix,
    });
    bullQueuesToClean.push(queue);
    await queue.add("seed", { visible: true });

    const registry = new QueueRegistry({
      discovery: {
        type: "bull",
        connectionUrl: `redis://127.0.0.1:6379/${DISCOVERY_DB}`,
        prefix,
        maxQueues: 5,
      },
    });
    registriesToClose.push(registry);

    const entries = await discoverCompleteSweep(registry);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.adapter.getName()).toBe("emails");
    expect(entries[0]?.adapter.getType()).toBe("bull");
    await expect(entries[0]?.adapter.getJobCounts()).resolves.toBeDefined();
  });

  it("discovers queues when the configured Redis prefix contains glob brackets", async () => {
    const prefix = `queuedash[discovery]-${faker.string.uuid()}`;
    const queue = new BullMQQueue("emails", {
      connection: { host: "127.0.0.1", port: 6379, db: DISCOVERY_DB },
      prefix,
    });
    queuesToClean.push(queue);
    await queue.add("seed", { visible: true });

    const registry = new QueueRegistry({
      discovery: {
        type: "bullmq",
        connectionUrl: `redis://127.0.0.1:6379/${DISCOVERY_DB}`,
        prefix,
      },
    });
    registriesToClose.push(registry);

    const entries = await discoverCompleteSweep(registry);

    expect(entries.map(({ adapter }) => adapter.getName())).toEqual(["emails"]);
  });

  it("resumes a truncated keyspace sweep instead of restarting it", async () => {
    const prefix = `queuedash-bounded-sweep-${faker.string.uuid()}`;
    const queueNames = ["alpha", "bravo", "charlie"];
    const seeder = new Redis({
      host: "127.0.0.1",
      port: 6379,
      db: DISCOVERY_DB,
    });
    let registry: QueueRegistry | undefined;

    try {
      for (let i = 0; i < BOUNDED_SWEEP_FILLER_KEYS; i += 10_000) {
        const filler = seeder.pipeline();
        const end = Math.min(i + 10_000, BOUNDED_SWEEP_FILLER_KEYS);
        for (let key = i; key < end; key += 1) {
          filler.set(`${prefix}:filler:${key}`, "1");
        }
        await filler.exec();
      }
      const markers = seeder.pipeline();
      for (const name of queueNames) markers.set(`${prefix}:${name}:meta`, "1");
      await markers.exec();

      registry = new QueueRegistry({
        discovery: {
          type: "bullmq",
          connectionUrl: `redis://127.0.0.1:6379/${DISCOVERY_DB}`,
          prefix,
          maxQueues: 10,
        },
      });

      // The first sweep cannot reach the end of the keyspace, so it has to
      // park a non-zero cursor rather than report a complete result.
      await registry.list();
      expect(registry.getDiscoveryStatus().truncated).toBe(true);

      // Later refreshes resume from that cursor. A cursor compared against the
      // wrong type would rescan page one forever and never settle here.
      const entries = await discoverCompleteSweep(registry);

      expect(entries.map(({ adapter }) => adapter.getName()).sort()).toEqual(
        queueNames,
      );
      expect(registry.getDiscoveryStatus().truncated).toBe(false);
    } finally {
      await registry?.close();
      let cursor = "0";
      do {
        const [next, keys] = await seeder.scan(
          cursor,
          "MATCH",
          `${prefix}:*`,
          "COUNT",
          5_000,
        );
        cursor = next;
        if (keys.length > 0) await seeder.unlink(...keys);
      } while (cursor !== "0");
      await seeder.quit();
    }
    // Seeding a quarter of a million keys is I/O bound, so the shared 5s
    // default leaves too little headroom on a slower CI machine.
  }, 30_000);

  it("excludes hidden queues from discovery results and status counts", async () => {
    const prefix = `queuedash-hidden-discovery-${faker.string.uuid()}`;
    const visibleQueue = new BullMQQueue("visible", {
      connection: { host: "127.0.0.1", port: 6379, db: DISCOVERY_DB },
      prefix,
    });
    const hiddenQueue = new BullMQQueue("internal-secret", {
      connection: { host: "127.0.0.1", port: 6379, db: DISCOVERY_DB },
      prefix,
    });
    queuesToClean.push(visibleQueue, hiddenQueue);
    await Promise.all([
      visibleQueue.add("seed", { visible: true }),
      hiddenQueue.add("seed", { visible: false }),
    ]);

    const ctx = {
      discovery: {
        type: "bullmq",
        connectionUrl: `redis://127.0.0.1:6379/${DISCOVERY_DB}`,
        prefix,
      },
      access: {
        rules: [{ queues: ["internal-secret"], mode: "hidden" }],
      },
    } satisfies Context;
    const registry = getQueueRegistry(ctx);
    registriesToClose.push(registry);

    const entries = await discoverCompleteSweep(registry);
    const settings = await appRouter.createCaller(ctx).settings.get();

    expect(entries.map(({ adapter }) => adapter.getName())).toEqual([
      "visible",
    ]);
    expect(settings.discovery.discoveredCount).toBe(1);
    expect(JSON.stringify(settings)).not.toContain("internal-secret");
  });

  it("does not let a discovered queue that can never connect hold up requests", async () => {
    const prefix = `queuedash-unreachable-${faker.string.uuid()}`;
    const staticQueue = new BullMQQueue("static", {
      connection: { host: "127.0.0.1", port: 6379, db: DISCOVERY_DB },
      prefix,
    });
    queuesToClean.push(staticQueue);
    await staticQueue.add("seed", {});
    const seeder = new Redis({
      host: "127.0.0.1",
      port: 6379,
      db: DISCOVERY_DB,
    });
    const marker = `${prefix}:unreachable:meta`;
    await seeder.hset(marker, "opts.maxLenEvents", "10000");

    // Redis at maxclients: the discovery sweep's connection gets through, and
    // every connection after it is turned away with Redis's own error.
    let connections = 0;
    const sockets = new Set<net.Socket>();
    const proxy = net.createServer((socket) => {
      connections += 1;
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => sockets.delete(socket));
      if (connections > 1) {
        socket.end("-ERR max number of clients reached\r\n");
        return;
      }
      const upstream = net.connect(6379, "127.0.0.1");
      upstream.on("error", () => socket.destroy());
      upstream.on("close", () => socket.destroy());
      socket.on("close", () => upstream.destroy());
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const { port } = proxy.address() as AddressInfo;
    const unhandledRejection = vi.fn();
    process.on("unhandledRejection", unhandledRejection);
    const close = vi.spyOn(BullMQQueue.prototype, "close");
    // BullMQ logs each refused attempt of a queue with no error listener.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      const ctx = {
        queues: [{ queue: staticQueue, displayName: "Static", type: "bullmq" }],
        discovery: {
          type: "bullmq",
          connectionUrl: `redis://127.0.0.1:${port}/${DISCOVERY_DB}`,
          prefix,
        },
      } satisfies Context;
      registriesToClose.push(getQueueRegistry(ctx));

      const startedAt = performance.now();
      const queues = await appRouter.createCaller(ctx).queue.list();

      expect(performance.now() - startedAt).toBeLessThan(2_000);
      expect(queues.map(({ name }) => name)).toEqual(["static"]);
      expect(queues[0]?.failedCount).toBe(0);
      // The sweep found the marker and the queue tried to connect, so the
      // handshake gave up by itself and the queue was closed after it had.
      expect(getQueueRegistry(ctx).getDiscoveryStatus().truncated).toBe(false);
      expect(connections).toBeGreaterThan(1);
      expect(
        (close.mock.contexts as BullMQQueue[]).map((queue) => queue.name),
      ).toEqual(["unreachable"]);
      const attempts = connections;
      await sleep(1_000);
      expect(connections).toBe(attempts);
      expect(unhandledRejection).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      close.mockRestore();
      process.off("unhandledRejection", unhandledRejection);
      await seeder.del(marker);
      await seeder.quit();
      for (const socket of sockets) socket.destroy();
      proxy.close();
    }
  });

  it("leaves the application's queue meta untouched", async () => {
    const prefix = `queuedash-app-meta-${faker.string.uuid()}`;
    const queue = new BullMQQueue("emails", {
      connection: { host: "127.0.0.1", port: 6379, db: DISCOVERY_DB },
      prefix,
      streams: { events: { maxLen: 100 } },
    });
    queuesToClean.push(queue);
    await queue.add("seed", {});
    const redis = new Redis({
      host: "127.0.0.1",
      port: 6379,
      db: DISCOVERY_DB,
    });
    const metaKey = `${prefix}:emails:meta`;

    try {
      await vi.waitFor(async () =>
        expect(await redis.hget(metaKey, "version")).toBeTruthy(),
      );
      const applicationMeta = await redis.hgetall(metaKey);
      expect(applicationMeta["opts.maxLenEvents"]).toBe("100");

      const registry = new QueueRegistry({
        discovery: {
          type: "bullmq",
          connectionUrl: `redis://127.0.0.1:6379/${DISCOVERY_DB}`,
          prefix,
        },
      });
      registriesToClose.push(registry);
      const [entry] = await discoverCompleteSweep(registry);
      expect(entry?.adapter.getName()).toBe("emails");
      // Commands on one connection run in order, so once this returns, any
      // meta write the discovered queue issued as it connected has landed.
      await entry?.adapter.getJobCounts();

      expect(await redis.hgetall(metaKey)).toEqual(applicationMeta);
    } finally {
      await redis.quit();
    }
  });
});
