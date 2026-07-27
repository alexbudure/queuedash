import { describe, expect, it } from "vitest";

import { detectQueueType } from "../queue-adapters/adapter-factory";
import { QueueRegistry, getQueueNameFromMarker } from "../queue-registry";
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
