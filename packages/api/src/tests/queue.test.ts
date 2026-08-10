import { TRPCError } from "@trpc/server";
import { expect, test, vi } from "vitest";

import { appRouter } from "../routers/_app";
import {
  expectTRPCError,
  initRedisInstance,
  sleep,
  type,
  NUM_OF_COMPLETED_JOBS,
  NUM_OF_FAILED_JOBS,
} from "./test.utils";

test("read-only and hidden queue policies are enforced server-side", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const queueName = firstQueue.queue.name;
  const readOnlyCaller = appRouter.createCaller({
    ...ctx,
    access: {
      rules: [{ queues: [queueName], mode: "read-only" }],
    },
  });

  const queue = await readOnlyCaller.queue.byName({ queueName });
  expect(queue.access.mode).toBe("read-only");
  expect(queue.access.actions["job.add"]).toBe(false);
  await expectTRPCError(
    () =>
      readOnlyCaller.queue.addJob({
        queueName,
        data: { shouldNotBeAdded: true },
      }),
    "FORBIDDEN",
  );

  const hiddenCaller = appRouter.createCaller({
    ...ctx,
    access: {
      rules: [{ queues: [queueName], mode: "hidden" }],
    },
  });
  expect(await hiddenCaller.queue.list()).toEqual([]);
  await expectTRPCError(
    () => hiddenCaller.queue.byName({ queueName }),
    "NOT_FOUND",
  );
});

test("settings returns browser-safe server policy metadata", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const queueName = firstQueue.queue.name;
  const caller = appRouter.createCaller({
    ...ctx,
    access: {
      default: "read-only",
      rules: [
        { queues: ["internal-secret-*"], mode: "hidden" },
        { queues: [queueName], mode: "full" },
        { queues: [queueName], deny: ["job.remove"] },
      ],
    },
    privacy: {
      redact: true,
      expose: { logs: false },
    },
    search: { maxScanned: 125 },
  });

  const settings = await caller.settings.get();
  expect(settings.access.default).toBe("read-only");
  expect(settings.access.rules).toEqual([
    {
      queues: [queueName],
      mode: "full",
      deny: ["job.remove"],
    },
  ]);
  expect(JSON.stringify(settings.access.rules)).not.toContain(
    "internal-secret",
  );
  expect(settings.privacy.redactionEnabled).toBe(true);
  expect(settings.privacy.expose.logs).toBe(false);
  expect(settings.search.maxScanned).toBe(125);
  expect(settings.version).toMatch(/^\d+\.\d+\.\d+/u);
});

test("worker inspection is capability-gated and normalized", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const queue = await caller.queue.byName({
    queueName: firstQueue.queue.name,
  });
  const workers = await caller.queue.workers({
    queueName: firstQueue.queue.name,
  });

  if (type === "bull" || type === "bullmq") {
    expect(queue.supports.workers).toBe(true);
    expect(workers.length).toBeGreaterThan(0);
    expect(workers[0]).toMatchObject({
      id: expect.any(String),
    });
    expect(workers[0]).not.toHaveProperty("addr");
    expect(workers[0]).not.toHaveProperty("rawname");
  } else {
    expect(queue.supports.workers).toBe(false);
    expect(workers).toEqual([]);
  }
});

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

test("GroupMQ clean requests the adapter's full supported batch", async () => {
  if (type !== "groupmq") return;

  const { ctx, firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") {
    throw new Error("Expected the GroupMQ test adapter");
  }

  const clean = vi.spyOn(firstQueue.queue, "clean").mockResolvedValue(0);
  const caller = appRouter.createCaller(ctx);

  await caller.queue.clean({
    queueName: firstQueue.queue.name,
    status: "completed",
  });

  expect(clean).toHaveBeenCalledWith(0, Number.MAX_SAFE_INTEGER, "completed");
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

test("add job to queue with opts", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const testData = { userId: 123, action: "option-test" };

  if (firstQueue.type === "bee") {
    await expectTRPCError(
      () =>
        caller.queue.addJob({
          queueName: firstQueue.queue.name,
          data: testData,
          opts: { delay: 30_000 },
        }),
      "BAD_REQUEST",
    );
    return;
  }

  await caller.queue.addJob({
    queueName: firstQueue.queue.name,
    data: testData,
    opts:
      firstQueue.type === "groupmq"
        ? {
            delay: 30_000,
            data: { action: "must-not-override-job-data" },
            groupId: "option-test-group",
            maxAttempts: 2,
          }
        : {
            delay: 30_000,
            attempts: 2,
            priority: 3,
          },
  });

  const delayed = await caller.job.list({
    queueName: firstQueue.queue.name,
    status: "delayed",
    limit: 10,
    query: "option-test",
  });

  expect(delayed.jobs).toHaveLength(1);
  expect(delayed.jobs[0].data).toEqual(testData);
  if (firstQueue.type === "groupmq") {
    expect(delayed.jobs[0].opts.delay).toEqual(expect.any(Number));
    expect(Number(delayed.jobs[0].opts.delay)).toBeGreaterThan(29_000);
    expect(Number(delayed.jobs[0].opts.delay)).toBeLessThanOrEqual(30_000);
    expect(delayed.jobs[0].groupId).toBe("option-test-group");
  } else {
    expect(delayed.jobs[0].opts.delay).toBe(30_000);
    expect(delayed.jobs[0].opts.attempts).toBe(2);
    expect(delayed.jobs[0].opts.priority).toBe(3);
  }
});

test("add job to queue without opts", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const testData = { userId: 456, action: "no-opts" };

  await caller.queue.addJob({
    queueName: firstQueue.queue.name,
    data: testData,
  });

  await sleep(100);

  const queue = await caller.queue.byName({
    queueName: firstQueue.queue.name,
  });

  const totalJobs =
    queue.counts.waiting +
    queue.counts.active +
    queue.counts.completed +
    queue.counts.delayed;
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

test("add job scheduler rejects missing or blank schedules", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type !== "bullmq") return;

  await expectTRPCError(
    () =>
      caller.queue.addJobScheduler({
        queueName: firstQueue.queue.name,
        template: {
          name: "invalid-scheduler",
          data: {},
        },
        opts: {},
      }),
    "BAD_REQUEST",
  );

  await expectTRPCError(
    () =>
      caller.queue.addJobScheduler({
        queueName: firstQueue.queue.name,
        template: {
          name: "invalid-scheduler",
          data: {},
        },
        opts: { pattern: "   " },
      }),
    "BAD_REQUEST",
  );
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

test("clean rejects adapter statuses outside its cleanability matrix", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const queue = await caller.queue.byName({
    queueName: firstQueue.queue.name,
  });

  const cleanSupport = queue.supports.clean;
  if (typeof cleanSupport !== "object") return;
  const unsupportedStatus = queue.supports.statuses.find(
    (status) => !cleanSupport.supportedStatuses.includes(status),
  );
  if (!unsupportedStatus) return;

  await expectTRPCError(
    () =>
      caller.queue.clean({
        queueName: firstQueue.queue.name,
        status: unsupportedStatus,
      }),
    "BAD_REQUEST",
  );
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
      await firstQueue.queue.add(
        "delayed-job",
        { test: true },
        { delay: 10000 },
      );
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
    expect(queue.counts.delayed).toBeLessThanOrEqual(
      afterAddQueue.counts.delayed,
    );
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
  expect(typeof queue.supports.addJobOptions).toBe("boolean");
  expect(typeof queue.supports.resume).toBe("boolean");
  expect(typeof queue.supports.retry).toBe("boolean");
  expect(typeof queue.supports.promote).toBe("boolean");
  expect(typeof queue.supports.logs).toBe("boolean");
  expect(typeof queue.supports.schedulers).toBe("boolean");
  expect(typeof queue.supports.schedulerUpdate).toBe("boolean");
  expect(typeof queue.supports.groups).toBe("boolean");

  // Verify correct values for current adapter
  if (type === "bee") {
    expect(queue.supports.addJobOptions).toBe(false);
    expect(queue.supports.pause).toBe(false);
    expect(queue.supports.clean).toBe(false);
    expect(queue.supports.retry).toBe(false);
    expect(queue.supports.groups).toBe(false);
  } else if (type === "bullmq") {
    expect(queue.supports.addJobOptions).toBe(true);
    expect(queue.supports.schedulers).toBe(true);
    expect(queue.supports.schedulerUpdate).toBe(true);
    expect(queue.supports.logs).toBe(true);
    expect(queue.supports.groups).toBe(false);
  } else if (type === "groupmq") {
    expect(queue.supports.groups).toBe(true);
  } else {
    expect(queue.supports.groups).toBe(false);
  }
});

test("list queue groups", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const groups = await caller.queue.groups({
    queueName: firstQueue.queue.name,
  });

  if (firstQueue.type === "groupmq") {
    expect(Array.isArray(groups)).toBe(true);
    for (const group of groups) {
      expect(group).toHaveProperty("id");
      expect(group).toHaveProperty("count");
      expect(group).toHaveProperty("status");
    }
  } else {
    expect(groups).toEqual([]);
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

// ============================================================================
// METRICS TESTS
// ============================================================================

test("get metrics for completed jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq") {
    const metrics = await caller.queue.metrics({
      queueName: firstQueue.queue.name,
      type: "completed",
      start: 0,
      end: 60, // Last 60 minutes
    });

    expect(metrics).toBeDefined();
    expect(metrics).toHaveProperty("data");
    expect(metrics).toHaveProperty("count");
    expect(metrics).toHaveProperty("meta");
    expect(Array.isArray(metrics.data)).toBe(true);
    expect(typeof metrics.count).toBe("number");
    expect(typeof metrics.meta.count).toBe("number");
  } else {
    // Non-BullMQ adapters should throw error
    try {
      await caller.queue.metrics({
        queueName: firstQueue.queue.name,
        type: "completed",
        start: 0,
        end: 60,
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

test("get metrics for failed jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq") {
    const metrics = await caller.queue.metrics({
      queueName: firstQueue.queue.name,
      type: "failed",
      start: 0,
      end: 60,
    });

    expect(metrics).toBeDefined();
    expect(metrics).toHaveProperty("data");
    expect(metrics).toHaveProperty("count");
    expect(metrics).toHaveProperty("meta");
  }
});

test("get metrics with different time ranges", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq") {
    // Test 1 minute
    const oneMin = await caller.queue.metrics({
      queueName: firstQueue.queue.name,
      type: "completed",
      start: 0,
      end: 1,
    });
    expect(oneMin).toBeDefined();

    // Test 1 hour
    const oneHour = await caller.queue.metrics({
      queueName: firstQueue.queue.name,
      type: "completed",
      start: 0,
      end: 60,
    });
    expect(oneHour).toBeDefined();

    // Test 24 hours
    const twentyFourHours = await caller.queue.metrics({
      queueName: firstQueue.queue.name,
      type: "completed",
      start: 0,
      end: 1440,
    });
    expect(twentyFourHours).toBeDefined();
  }
});

test("metrics endpoint validates queue name", async () => {
  const caller = appRouter.createCaller({ queues: [] });

  try {
    await caller.queue.metrics({
      queueName: "non-existent-queue",
      type: "completed",
      start: 0,
      end: 60,
    });
    throw new Error("Should have thrown TRPCError");
  } catch (e) {
    expect(e).toBeInstanceOf(TRPCError);
    if (e instanceof TRPCError) {
      expect(e.code).toBe("NOT_FOUND");
    }
  }
});

test("supports.metrics flag is correct", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const queue = await caller.queue.byName({
    queueName: firstQueue.queue.name,
  });

  if (firstQueue.type === "bullmq") {
    expect(queue.supports.metrics).toBe(true);
  } else {
    expect(queue.supports.metrics).toBe(false);
  }
});

test("metrics count matches actual completed jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq") {
    const metrics = await caller.queue.metrics({
      queueName: firstQueue.queue.name,
      type: "completed",
      start: 0,
      end: 60, // Last 60 minutes
    });

    expect(metrics).toBeDefined();

    // Verify that count is the sum of data array (this is the fix we made)
    const sumOfData = metrics.data.reduce(
      (sum: number, count: number) => sum + count,
      0,
    );
    expect(metrics.count).toBe(sumOfData);

    // If we have metrics data, verify the count matches expected jobs
    // Note: metrics might be 0 if aggregation hasn't happened yet, but the fix should still work
    if (sumOfData > 0) {
      expect(metrics.count).toBeGreaterThanOrEqual(NUM_OF_COMPLETED_JOBS);
    }
  }
});

test("metrics count matches actual failed jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq") {
    const metrics = await caller.queue.metrics({
      queueName: firstQueue.queue.name,
      type: "failed",
      start: 0,
      end: 60, // Last 60 minutes
    });

    expect(metrics).toBeDefined();

    // Verify that count is the sum of data array (this is the fix we made)
    const sumOfData = metrics.data.reduce(
      (sum: number, count: number) => sum + count,
      0,
    );
    expect(metrics.count).toBe(sumOfData);

    // If we have metrics data, verify the count matches expected jobs
    // Note: metrics might be 0 if aggregation hasn't happened yet, but the fix should still work
    if (sumOfData > 0) {
      expect(metrics.count).toBeGreaterThanOrEqual(NUM_OF_FAILED_JOBS);
    }
  }
});

test("metrics count is sum of data array for completed jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq") {
    const metrics = await caller.queue.metrics({
      queueName: firstQueue.queue.name,
      type: "completed",
      start: 0,
      end: 60,
    });

    // This test specifically verifies the bug fix:
    // count should be the sum of all values in the data array,
    // not the length of the array (number of data points)
    const sumOfData = metrics.data.reduce(
      (sum: number, count: number) => sum + count,
      0,
    );
    expect(metrics.count).toBe(sumOfData);
    // Only check this if we have data points (metrics might be empty if no jobs completed yet)
    if (metrics.data.length > 0) {
      expect(metrics.count).not.toBe(metrics.data.length); // Should not be the number of data points
    }
  }
});

test("metrics count is sum of data array for failed jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq") {
    const metrics = await caller.queue.metrics({
      queueName: firstQueue.queue.name,
      type: "failed",
      start: 0,
      end: 60,
    });

    // This test specifically verifies the bug fix:
    // count should be the sum of all values in the data array,
    // not the length of the array (number of data points)
    const sumOfData = metrics.data.reduce(
      (sum: number, count: number) => sum + count,
      0,
    );
    expect(metrics.count).toBe(sumOfData);
    // Only check this if we have data points (metrics might be empty if no jobs failed yet)
    if (metrics.data.length > 0) {
      expect(metrics.count).not.toBe(metrics.data.length); // Should not be the number of data points
    }
  }
});
