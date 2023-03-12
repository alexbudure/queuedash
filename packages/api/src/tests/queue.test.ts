import { appRouter } from "../routers/_app";
import { expect, test } from "vitest";
import { initRedisInstance, type } from "./test.utils";
import { TRPCError } from "@trpc/server";

test("list queues", async () => {
  const { ctx } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const queues = await caller.queue.list();

  expect(queues).toMatchObject(
    ctx.queues.map((q) => {
      return {
        name: q.queue.name,
        displayName: q.displayName,
      };
    })
  );
});

test("get queue by name", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const queue = await caller.queue.byName({
    queueName: firstQueue.queue.name,
  });

  expect(queue).toMatchObject({
    displayName: firstQueue.displayName,
    name: firstQueue.queue.name,
  });
});

test("pause queue", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.queue.pause({
      queueName: firstQueue.queue.name,
    });

    const queue = await caller.queue.byName({
      queueName: firstQueue.queue.name,
    });

    expect(queue).toMatchObject({
      displayName: firstQueue.displayName,
      name: firstQueue.queue.name,
      paused: true,
    });
  } catch (e) {
    expect(e).toBeInstanceOf(TRPCError);
    expect(type).toBe("bee");
    if (e instanceof TRPCError) {
      expect(e.code).toBe("BAD_REQUEST");
    }
  }
});

test("resume queue", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.queue.pause({
      queueName: firstQueue.queue.name,
    });

    await caller.queue.resume({
      queueName: firstQueue.queue.name,
    });

    const queue = await caller.queue.byName({
      queueName: firstQueue.queue.name,
    });

    expect(queue).toMatchObject({
      displayName: firstQueue.displayName,
      name: firstQueue.queue.name,
      paused: false,
    });
  } catch (e) {
    expect(e).toBeInstanceOf(TRPCError);
    expect(type).toBe("bee");
    if (e instanceof TRPCError) {
      expect(e.code).toBe("BAD_REQUEST");
    }
  }
});

test("clean completed jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.queue.clean({
      queueName: firstQueue.queue.name,
      status: "completed",
    });

    const queue = await caller.queue.byName({
      queueName: firstQueue.queue.name,
    });

    expect(queue).toMatchObject({
      displayName: firstQueue.displayName,
      name: firstQueue.queue.name,
      counts: {
        completed: 0,
      },
    });
  } catch (e) {
    expect(e).toBeInstanceOf(TRPCError);
    expect(type).toBe("bee");
    if (e instanceof TRPCError) {
      expect(e.code).toBe("BAD_REQUEST");
    }
  }
});

test("clean failed jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.queue.clean({
      queueName: firstQueue.queue.name,
      status: "failed",
    });

    const queue = await caller.queue.byName({
      queueName: firstQueue.queue.name,
    });

    expect(queue).toMatchObject({
      displayName: firstQueue.displayName,
      name: firstQueue.queue.name,
      counts: {
        failed: 0,
      },
    });
  } catch (e) {
    expect(e).toBeInstanceOf(TRPCError);
    expect(type).toBe("bee");
    if (e instanceof TRPCError) {
      expect(e.code).toBe("BAD_REQUEST");
    }
  }
});

// TODO: addJob
// TODO: empty
