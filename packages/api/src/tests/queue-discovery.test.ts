import { faker } from "@faker-js/faker";
import { Queue as BullMQQueue } from "bullmq";
import { afterEach, describe, expect, it } from "vitest";

import { QueueRegistry } from "../queue-registry";

const queuesToClean: BullMQQueue[] = [];
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
});

describe("queue discovery", () => {
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
});
