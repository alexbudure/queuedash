import { faker } from "@faker-js/faker";
import Bull from "bull";
import { Queue as BullMQQueue } from "bullmq";
import { afterEach, describe, expect, it } from "vitest";

import {
  getQueueRegistry,
  normalizeDiscoveryMaxQueues,
  normalizeDiscoveryRefreshInterval,
  QueueRegistry,
} from "../queue-registry";
import { appRouter } from "../routers/_app";
import type { Context } from "../trpc";

const queuesToClean: BullMQQueue[] = [];
const bullQueuesToClean: Bull.Queue[] = [];
const registriesToClose: QueueRegistry[] = [];

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
      connectionUrl: "redis://127.0.0.1:6379",
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
      connection: { host: "127.0.0.1", port: 6379 },
      prefix,
    });
    queuesToClean.push(queue);
    await queue.add("seed", { visible: true });

    const registry = new QueueRegistry({
      discovery: {
        type: "bullmq",
        connectionUrl: "redis://127.0.0.1:6379",
        prefix,
        maxQueues: 5,
      },
    });
    registriesToClose.push(registry);

    const entries = await registry.list();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.adapter.getName()).toBe("emails");
    expect(entries[0]?.adapter.getType()).toBe("bullmq");
    await expect(entries[0]?.adapter.getJobCounts()).resolves.toBeDefined();
  });

  it("ignores adapter-invalid markers without hiding valid queues", async () => {
    const prefix = `queuedash-invalid-marker-${faker.string.uuid()}`;
    const queue = new BullMQQueue("emails", {
      connection: { host: "127.0.0.1", port: 6379 },
      prefix,
    });
    queuesToClean.push(queue);
    await queue.add("seed", {});
    const client = await queue.client;
    const invalidMarker = `${prefix}:tenant:emails:meta`;
    await client.set(invalidMarker, "1");

    try {
      const registry = new QueueRegistry({
        discovery: {
          type: "bullmq",
          connectionUrl: "redis://127.0.0.1:6379",
          prefix,
        },
      });
      registriesToClose.push(registry);

      expect(
        (await registry.list()).map(({ adapter }) => adapter.getName()),
      ).toEqual(["emails"]);
    } finally {
      await client.del(invalidMarker);
    }
  });

  it("does not let a static queue consume the discovery cap", async () => {
    const prefix = `queuedash-static-cap-${faker.string.uuid()}`;
    const staticQueue = new BullMQQueue("static", {
      connection: { host: "127.0.0.1", port: 6379 },
      prefix,
    });
    const discoveredQueue = new BullMQQueue("discovered", {
      connection: { host: "127.0.0.1", port: 6379 },
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
        connectionUrl: "redis://127.0.0.1:6379",
        prefix,
        maxQueues: 1,
      },
    });
    registriesToClose.push(registry);

    const names = (await registry.list()).map(({ adapter }) =>
      adapter.getName(),
    );
    expect(names).toEqual(["static", "discovered"]);
  });

  it("finds an ordinary running Bull v4 queue from its persistent id marker", async () => {
    const prefix = `queuedash-bull-discovery-${faker.string.uuid()}`;
    const queue = new Bull("emails", "redis://127.0.0.1:6379", { prefix });
    bullQueuesToClean.push(queue);
    await queue.add("seed", { visible: true });

    const registry = new QueueRegistry({
      discovery: {
        type: "bull",
        connectionUrl: "redis://127.0.0.1:6379",
        prefix,
        maxQueues: 5,
      },
    });
    registriesToClose.push(registry);

    const entries = await registry.list();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.adapter.getName()).toBe("emails");
    expect(entries[0]?.adapter.getType()).toBe("bull");
    await expect(entries[0]?.adapter.getJobCounts()).resolves.toBeDefined();
  });

  it("discovers queues when the configured Redis prefix contains glob brackets", async () => {
    const prefix = `queuedash[discovery]-${faker.string.uuid()}`;
    const queue = new BullMQQueue("emails", {
      connection: { host: "127.0.0.1", port: 6379 },
      prefix,
    });
    queuesToClean.push(queue);
    await queue.add("seed", { visible: true });

    const registry = new QueueRegistry({
      discovery: {
        type: "bullmq",
        connectionUrl: "redis://127.0.0.1:6379",
        prefix,
      },
    });
    registriesToClose.push(registry);

    const entries = await registry.list();

    expect(entries.map(({ adapter }) => adapter.getName())).toEqual(["emails"]);
  });

  it("excludes hidden queues from discovery results and status counts", async () => {
    const prefix = `queuedash-hidden-discovery-${faker.string.uuid()}`;
    const visibleQueue = new BullMQQueue("visible", {
      connection: { host: "127.0.0.1", port: 6379 },
      prefix,
    });
    const hiddenQueue = new BullMQQueue("internal-secret", {
      connection: { host: "127.0.0.1", port: 6379 },
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
        connectionUrl: "redis://127.0.0.1:6379",
        prefix,
      },
      access: {
        rules: [{ queues: ["internal-secret"], mode: "hidden" }],
      },
    } satisfies Context;
    const registry = getQueueRegistry(ctx);
    registriesToClose.push(registry);

    const [entries, settings] = await Promise.all([
      registry.list(),
      appRouter.createCaller(ctx).settings.get(),
    ]);

    expect(entries.map(({ adapter }) => adapter.getName())).toEqual([
      "visible",
    ]);
    expect(settings.discovery.discoveredCount).toBe(1);
    expect(JSON.stringify(settings)).not.toContain("internal-secret");
  });
});
