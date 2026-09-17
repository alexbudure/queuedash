import { describe, expect, it } from "vitest";

import { detectQueueType } from "../queue-adapters/adapter-factory";
import {
  QueueRegistry,
  closeQueuedashContext,
  getQueueNameFromMarker,
  getQueueRegistry,
} from "../queue-registry";
import type { Context } from "../trpc";

describe("queue registry", () => {
  it("distinguishes Bull from BullMQ when both expose getWorkers", () => {
    expect(
      detectQueueType({
        add() {},
        client: {},
        getWorkers() {},
        process() {},
      } as never),
    ).toBe("bull");
    expect(
      detectQueueType({
        add() {},
        client: {},
        getWorkers() {},
      } as never),
    ).toBe("bullmq");
  });

  it("extracts queue names from exact prefix/meta marker keys", () => {
    expect(getQueueNameFromMarker("bull:emails:meta", "bull")).toBe("emails");
    expect(getQueueNameFromMarker("bull:tenant:emails:meta", "bull")).toBe(
      "tenant:emails",
    );
    expect(getQueueNameFromMarker("other:emails:meta", "bull")).toBeNull();
    expect(getQueueNameFromMarker("bull:emails:wait", "bull")).toBeNull();
    expect(getQueueNameFromMarker("bull:emails:id", "bull", "id")).toBe(
      "emails",
    );
  });

  it("isolates registries for contexts that share discovery configuration", () => {
    const discovery = {
      type: "bullmq" as const,
      connectionUrl: "redis://127.0.0.1:6379",
    };
    const firstContext = {
      discovery,
      queues: [],
    } satisfies Context;
    const secondContext = {
      discovery,
      queues: [],
      access: { default: "read-only" as const },
    } satisfies Context;

    expect(getQueueRegistry(firstContext)).not.toBe(
      getQueueRegistry(secondContext),
    );
    expect(getQueueRegistry(firstContext)).toBe(getQueueRegistry(firstContext));
  });

  it("does not share registries across equivalent context objects", async () => {
    const queue = { name: "static" };
    const createContext = (): Context =>
      ({
        queues: [
          {
            queue,
            displayName: "Static",
            type: "bull",
          },
        ],
        discovery: {
          type: "bullmq",
          connectionUrl: "redis://127.0.0.1:6379",
          prefix: "request-scoped",
        },
        access: {
          default: "full",
          rules: [{ queues: ["internal-*"], mode: "hidden" }],
        },
        privacy: { redact: true },
      }) as unknown as Context;

    const first = createContext();
    const second = createContext();
    expect(first).not.toBe(second);
    expect(getQueueRegistry(first)).not.toBe(getQueueRegistry(second));
    expect(getQueueRegistry(first)).toBe(getQueueRegistry(first));

    const differentPolicy = createContext();
    differentPolicy.access = { default: "read-only" };
    expect(getQueueRegistry(differentPolicy)).not.toBe(getQueueRegistry(first));
    await getQueueRegistry(first).close();
    await getQueueRegistry(second).close();
    await getQueueRegistry(differentPolicy).close();
  });

  it("removes a closed context registry from the cache", async () => {
    const ctx = { queues: [] } satisfies Context;
    const first = getQueueRegistry(ctx);

    await closeQueuedashContext(ctx);

    expect(getQueueRegistry(ctx)).not.toBe(first);
  });

  it("caches adapters and keeps the first static queue on duplicate names", async () => {
    const firstQueue = {
      name: "emails",
    };
    const duplicateQueue = {
      name: "emails",
    };
    const ctx = {
      queues: [
        {
          queue: firstQueue,
          displayName: "Emails",
          type: "bull",
        },
        {
          queue: duplicateQueue,
          displayName: "Duplicate",
          type: "bull",
        },
      ],
    } as unknown as Context;
    const registry = new QueueRegistry(ctx);

    const first = await registry.list();
    const second = await registry.list();

    expect(first).toHaveLength(1);
    expect(first[0]?.adapter.getDisplayName()).toBe("Emails");
    expect(second[0]?.adapter).toBe(first[0]?.adapter);
  });
});
