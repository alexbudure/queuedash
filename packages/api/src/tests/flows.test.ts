import { faker } from "@faker-js/faker";
import * as BullMQ from "bullmq";
import { describe, expect, onTestFinished, test } from "vitest";

import { appRouter } from "../routers/_app";
import type { Context } from "../trpc";
import { expectTRPCError, initRedisInstance, sleep, type } from "./test.utils";

const uniqueName = (label: string) =>
  `flight-bookings-flow-${label}-${faker.string.alpha({ length: 6 })}`;

// fulfill-order (orders)
// ├ reserve (orders)
// ├ send-confirmation (emails)
// │ └ render (emails)
// ├ fraud-check (a queue the access rules hide)
// └ audit (a queue the dashboard does not know)
const createFlow = async () => {
  const names = {
    orders: uniqueName("orders"),
    emails: uniqueName("emails"),
    hidden: uniqueName("hidden"),
    unknown: uniqueName("unknown"),
  };
  const queues = {
    orders: new BullMQ.Queue(names.orders, { connection: {} }),
    emails: new BullMQ.Queue(names.emails, { connection: {} }),
    hidden: new BullMQ.Queue(names.hidden, { connection: {} }),
    unknown: new BullMQ.Queue(names.unknown, { connection: {} }),
  };
  onTestFinished(async () => {
    for (const queue of Object.values(queues)) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });

  const producer = new BullMQ.FlowProducer({ connection: {} });
  const flow = await producer.add({
    name: "fulfill-order",
    queueName: names.orders,
    data: { order: 4812 },
    children: [
      { name: "reserve", queueName: names.orders, data: {} },
      {
        name: "send-confirmation",
        queueName: names.emails,
        data: {},
        children: [{ name: "render", queueName: names.emails, data: {} }],
      },
      { name: "fraud-check", queueName: names.hidden, data: {} },
      { name: "audit", queueName: names.unknown, data: {} },
    ],
  });
  await producer.close();

  const byName = (name: string) => {
    const find = (node: BullMQ.JobNode): BullMQ.JobNode | undefined =>
      node.job.name === name
        ? node
        : node.children?.map(find).find((match) => match !== undefined);
    const node = find(flow);
    if (!node?.job.id) throw new Error(`No ${name} in the flow`);
    return node.job.id;
  };

  const ctx: Context = {
    queues: [
      { queue: queues.orders, displayName: "Orders", type: "bullmq" },
      { queue: queues.emails, displayName: "Emails", type: "bullmq" },
      { queue: queues.hidden, displayName: "Fraud", type: "bullmq" },
    ],
    access: { rules: [{ queues: [names.hidden], mode: "hidden" }] },
  };

  return { byName, ctx, names, queues };
};

describe.skipIf(type !== "bullmq")("flows", () => {
  test("the tree runs from the topmost visible ancestor", async () => {
    const { byName, ctx, names } = await createFlow();
    const caller = appRouter.createCaller(ctx);

    const tree = await caller.flow.tree({
      queueName: names.emails,
      jobId: byName("render"),
    });

    expect(tree.parentHidden).toBe(false);
    expect(tree.root).toMatchObject({
      name: "fulfill-order",
      queueName: names.orders,
      status: "waiting-children",
      childCount: 4,
      // fraud-check's queue is hidden and audit's is unknown: both counted,
      // neither named.
      hiddenChildren: 2,
      unloadedChildren: 0,
    });
    expect(tree.root.children.map(({ name }) => name).sort()).toEqual([
      "reserve",
      "send-confirmation",
    ]);
    const confirmation = tree.root.children.find(
      ({ name }) => name === "send-confirmation",
    );
    expect(confirmation).toMatchObject({
      queueName: names.emails,
      status: "waiting-children",
      childCount: 1,
    });
    expect(confirmation?.children).toMatchObject([
      { name: "render", status: "waiting", childCount: 0 },
    ]);
    expect(JSON.stringify(tree)).not.toContain("fraud-check");
  });

  test("a node's child limit leaves the rest to Show more", async () => {
    const { byName, ctx, names } = await createFlow();
    const caller = appRouter.createCaller(ctx);
    const rootId = byName("fulfill-order");

    const tree = await caller.flow.tree({
      queueName: names.orders,
      jobId: rootId,
      childLimits: { [`${names.orders}:${rootId}`]: 1 },
    });

    expect(tree.root.children.length + tree.root.hiddenChildren).toBe(1);
    expect(tree.root.unloadedChildren).toBe(3);
  });

  test("links show a job's parent and children", async () => {
    const { byName, ctx, names } = await createFlow();
    const caller = appRouter.createCaller(ctx);

    const parentLinks = await caller.flow.links({
      queueName: names.orders,
      jobId: byName("fulfill-order"),
    });
    expect(parentLinks?.parent).toBeNull();
    expect(parentLinks?.job).toMatchObject({
      childCount: 4,
      hiddenChildren: 2,
    });

    const childLinks = await caller.flow.links({
      queueName: names.emails,
      jobId: byName("send-confirmation"),
    });
    expect(childLinks?.parent).toMatchObject({
      name: "fulfill-order",
      status: "waiting-children",
    });
    expect(childLinks?.job.children).toMatchObject([{ name: "render" }]);
    expect(childLinks?.blocksParent).toBe(false);
  });

  test("a failed child with no failure handling blocks its parent", async () => {
    const { byName, ctx, names } = await createFlow();
    const caller = appRouter.createCaller(ctx);
    const worker = new BullMQ.Worker(
      names.orders,
      async (job) => {
        if (job.name === "reserve") throw new Error("Out of stock");
      },
      { connection: {} },
    );
    onTestFinished(() => worker.close());

    const reserveId = byName("reserve");
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const links = await caller.flow.links({
        queueName: names.orders,
        jobId: reserveId,
      });
      if (links?.job.status === "failed") break;
      await sleep(100);
    }

    const links = await caller.flow.links({
      queueName: names.orders,
      jobId: reserveId,
    });
    expect(links?.job).toMatchObject({
      status: "failed",
      failedReason: "Out of stock",
    });
    expect(links?.blocksParent).toBe(true);

    const tree = await caller.flow.tree({
      queueName: names.orders,
      jobId: reserveId,
    });
    expect(
      tree.root.children.find(({ name }) => name === "reserve"),
    ).toMatchObject({ status: "failed", blocksParent: true });
  });

  test("flows are unavailable when job ids are redacted", async () => {
    const { byName, ctx, names } = await createFlow();
    const caller = appRouter.createCaller({
      ...ctx,
      privacy: { redact: { keys: ["id"] } },
    });
    const input = { queueName: names.orders, jobId: byName("fulfill-order") };

    await expectTRPCError(() => caller.flow.tree(input), "FORBIDDEN");
    await expectTRPCError(() => caller.flow.links(input), "FORBIDDEN");
  });
});

test.skipIf(type === "bullmq")(
  "queues without flows refuse flow lookups",
  async () => {
    const { ctx, firstQueue } = await initRedisInstance();
    const caller = appRouter.createCaller(ctx);

    await expectTRPCError(
      () => caller.flow.tree({ queueName: firstQueue.queue.name, jobId: "1" }),
      "BAD_REQUEST",
    );
  },
);
