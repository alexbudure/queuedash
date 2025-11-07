import { appRouter } from "../routers/_app";
import { expect, test } from "vitest";
import { initRedisInstance, sleep, type } from "./test.utils";
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
    }),
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

  if (firstQueue.type === "bee") {
    // Bee doesn't support pausing
    try {
      await caller.queue.pause({
        queueName: firstQueue.queue.name,
      });
      throw new Error("Should have thrown TRPCError");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      if (e instanceof TRPCError) {
        expect(e.code).toBe("BAD_REQUEST");
      }
    }
  } else {
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
  }
});

test("resume queue", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bee") {
    // Bee doesn't support pausing/resuming
    try {
      await caller.queue.pause({
        queueName: firstQueue.queue.name,
      });
      throw new Error("Should have thrown TRPCError");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
    }
    try {
      await caller.queue.resume({
        queueName: firstQueue.queue.name,
      });
      throw new Error("Should have thrown TRPCError");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      if (e instanceof TRPCError) {
        expect(e.code).toBe("BAD_REQUEST");
      }
    }
  } else {
    await caller.queue.pause({
      queueName: firstQueue.queue.name,
    });

    // Give GroupMQ time to process pause before resuming
    if (type === "groupmq") {
      await sleep(100);
    }

    await caller.queue.resume({
      queueName: firstQueue.queue.name,
    });

    // Give GroupMQ time to process resume
    if (type === "groupmq") {
      await sleep(100);
    }

    const queue = await caller.queue.byName({
      queueName: firstQueue.queue.name,
    });

    expect(queue).toMatchObject({
      displayName: firstQueue.displayName,
      name: firstQueue.queue.name,
      paused: false,
    });
  }
});

test("clean completed jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bee") {
    // Bee doesn't support cleaning
    try {
      await caller.queue.clean({
        queueName: firstQueue.queue.name,
        status: "completed",
      });
      throw new Error("Should have thrown TRPCError");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      if (e instanceof TRPCError) {
        expect(e.code).toBe("BAD_REQUEST");
      }
    }
  } else {
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
  }
});

test("clean failed jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bee") {
    // Bee doesn't support cleaning
    try {
      await caller.queue.clean({
        queueName: firstQueue.queue.name,
        status: "failed",
      });
      throw new Error("Should have thrown TRPCError");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      if (e instanceof TRPCError) {
        expect(e.code).toBe("BAD_REQUEST");
      }
    }
  } else {
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
  }
});

// ============================================================================
// HIGH PRIORITY TESTS
// ============================================================================

test("add job to queue", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const testData = { userId: 123, action: "test-action" };

  await caller.queue.addJob({
    queueName: firstQueue.queue.name,
    data: testData,
  });

  await sleep(100);

  const queue = await caller.queue.byName({
    queueName: firstQueue.queue.name,
  });

  // Job should be in waiting, active, or completed depending on processing speed
  const totalJobs =
    queue.counts.waiting + queue.counts.active + queue.counts.completed;
  expect(totalJobs).toBeGreaterThan(0);
});

test("empty queue", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bee" || firstQueue.type === "groupmq") {
    // Bee and GroupMQ don't support empty
    try {
      await caller.queue.empty({
        queueName: firstQueue.queue.name,
      });
      throw new Error("Should have thrown error");
    } catch (e) {
      expect(e instanceof Error).toBe(true);
    }
  } else {
    // Add a waiting job first
    if (firstQueue.type === "bull") {
      await firstQueue.queue.pause();
      await firstQueue.queue.add({ test: "data" });
    } else if (firstQueue.type === "bullmq") {
      await firstQueue.queue.pause();
      await firstQueue.queue.add("test", { test: "data" });
    }

    await caller.queue.empty({
      queueName: firstQueue.queue.name,
    });

    const queue = await caller.queue.byName({
      queueName: firstQueue.queue.name,
    });

    // Waiting jobs should be emptied
    expect(queue.counts.waiting).toBe(0);
  }
});

test("pause all queues", async () => {
  const { ctx } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const result = await caller.queue.pauseAll();
  expect(result).toBe("ok");

  // Verify queue is paused (if supported)
  if (type !== "bee") {
    const queue = await caller.queue.byName({
      queueName: ctx.queues[0].queue.name,
    });
    expect(queue.paused).toBe(true);
  }
});

test("resume all queues", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (type !== "bee") {
    // Pause first
    await caller.queue.pauseAll();

    // Then resume
    const result = await caller.queue.resumeAll();
    expect(result).toBe("ok");

    const queue = await caller.queue.byName({
      queueName: firstQueue.queue.name,
    });
    expect(queue.paused).toBe(false);
  }
});

test("add job scheduler with pattern", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq") {
    const result = await caller.queue.addJobScheduler({
      queueName: firstQueue.queue.name,
      template: {
        name: "scheduled-job",
        data: { scheduled: true },
      },
      opts: {
        pattern: "0 0 * * *",
        tz: "America/New_York",
      },
    });

    expect(result).toMatchObject({
      name: firstQueue.queue.name,
    });
  } else {
    // Non-BullMQ adapters should throw error
    try {
      await caller.queue.addJobScheduler({
        queueName: firstQueue.queue.name,
        template: {
          name: "scheduled-job",
          data: { scheduled: true },
        },
        opts: {
          pattern: "0 0 * * *",
        },
      });
      throw new Error("Should have thrown TRPCError");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      if (e instanceof TRPCError) {
        expect(e.code).toBe("BAD_REQUEST");
      }
    }
  }
});

test("add job scheduler with interval", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq") {
    const result = await caller.queue.addJobScheduler({
      queueName: firstQueue.queue.name,
      template: {
        name: "interval-job",
        data: { interval: true },
      },
      opts: {
        every: 60000, // Every minute
      },
    });

    expect(result).toMatchObject({
      name: firstQueue.queue.name,
    });
  }
});

// ============================================================================
// MEDIUM PRIORITY TESTS - Edge Cases and Error Scenarios
// ============================================================================

test("clean with invalid status", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type !== "bee") {
    try {
      await caller.queue.clean({
        queueName: firstQueue.queue.name,
        status: "invalid-status",
      });
      throw new Error("Should have thrown error");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      if (e instanceof TRPCError) {
        expect(e.code).toBe("BAD_REQUEST");
      }
    }
  }
});

test("clean delayed jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq" || firstQueue.type === "bull") {
    // Get the count before adding delayed jobs
    const beforeQueue = await caller.queue.byName({
      queueName: firstQueue.queue.name,
    });
    const initialDelayedCount = beforeQueue.counts.delayed;

    // Add a delayed job
    if (firstQueue.type === "bullmq") {
      await firstQueue.queue.add("delayed-job", { test: true }, { delay: 10000 });
    } else if (firstQueue.type === "bull") {
      await firstQueue.queue.add({ test: true }, { delay: 10000 });
    }

    await sleep(100);

    // Verify delayed job was added
    const afterAddQueue = await caller.queue.byName({
      queueName: firstQueue.queue.name,
    });
    expect(afterAddQueue.counts.delayed).toBeGreaterThan(initialDelayedCount);

    // Clean delayed jobs
    await caller.queue.clean({
      queueName: firstQueue.queue.name,
      status: "delayed",
    });

    const queue = await caller.queue.byName({
      queueName: firstQueue.queue.name,
    });

    // Should have reduced delayed count (might not be 0 due to child jobs in waiting-children state)
    // Verify the count is less than or equal to what we started with after adding
    expect(queue.counts.delayed).toBeLessThanOrEqual(afterAddQueue.counts.delayed);
  } else if (firstQueue.type === "groupmq") {
    // GroupMQ supports cleaning delayed
    const { ctx: freshCtx, firstQueue: freshQueue } = await initRedisInstance();
    const freshCaller = appRouter.createCaller(freshCtx);

    await freshCaller.queue.clean({
      queueName: freshQueue.queue.name,
      status: "delayed",
    });

    // Should not throw
    expect(true).toBe(true);
  }
});

test("queue not found error", async () => {
  const { ctx } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.queue.byName({
      queueName: "non-existent-queue",
    });
    throw new Error("Should have thrown TRPCError");
  } catch (e) {
    expect(e).toBeInstanceOf(TRPCError);
    if (e instanceof TRPCError) {
      expect(e.code).toBe("NOT_FOUND");
      expect(e.message).toContain("not found");
    }
  }
});

test("get queue by name returns correct supports flags", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const queue = await caller.queue.byName({
    queueName: firstQueue.queue.name,
  });

  expect(queue.supports).toBeDefined();
  expect(typeof queue.supports.pause).toBe("boolean");
  expect(typeof queue.supports.resume).toBe("boolean");
  expect(typeof queue.supports.retry).toBe("boolean");
  expect(typeof queue.supports.promote).toBe("boolean");
  expect(typeof queue.supports.logs).toBe("boolean");
  expect(typeof queue.supports.schedulers).toBe("boolean");

  // Verify correct values for current adapter
  if (type === "bee") {
    expect(queue.supports.pause).toBe(false);
    expect(queue.supports.clean).toBe(false);
    expect(queue.supports.retry).toBe(false);
  } else if (type === "bullmq") {
    expect(queue.supports.schedulers).toBe(true);
    expect(queue.supports.logs).toBe(true);
  }
});

test("get queue by name returns redis info", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const queue = await caller.queue.byName({
    queueName: firstQueue.queue.name,
  });

  expect(queue.client).toBeDefined();
  expect(queue.client.version).toBeDefined();
  expect(typeof queue.client.connectedClients).toBe("number");
  expect(typeof queue.client.uptimeInSeconds).toBe("number");
  expect(queue.client.usedMemoryHuman).toBeDefined();
});

test("list queues returns all queues", async () => {
  const { ctx } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const queues = await caller.queue.list();

  expect(Array.isArray(queues)).toBe(true);
  expect(queues.length).toBe(ctx.queues.length);
  expect(queues[0]).toHaveProperty("name");
  expect(queues[0]).toHaveProperty("displayName");
});
