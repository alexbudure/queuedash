import { TRPCError } from "@trpc/server";
import { expect, test } from "vitest";

import { appRouter } from "../routers/_app";
import {
  expectTRPCError,
  initRedisInstance,
  NUM_OF_SCHEDULERS,
} from "./test.utils";

test("read-only queues can list schedulers but cannot add them", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller({
    ...ctx,
    access: {
      rules: [{ queues: [firstQueue.queue.name], mode: "read-only" }],
    },
  });

  if (firstQueue.type === "bullmq") {
    const schedulers = await caller.scheduler.list({
      queueName: firstQueue.queue.name,
    });
    expect(schedulers.length).toBe(NUM_OF_SCHEDULERS);
  }

  await expectTRPCError(
    () =>
      caller.scheduler.add({
        queueName: firstQueue.queue.name,
        jobName: "blocked-scheduler",
        data: {},
        pattern: "0 0 * * *",
      }),
    "FORBIDDEN",
  );
  await expectTRPCError(
    () =>
      caller.scheduler.update({
        queueName: firstQueue.queue.name,
        key: "blocked-scheduler",
        template: { data: {} },
        opts: { every: 60_000 },
      }),
    "FORBIDDEN",
  );
});

test("list schedulers", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  try {
    const caller = appRouter.createCaller(ctx);
    const list = await caller.scheduler.list({
      queueName: firstQueue.queue.name,
    });

    expect(list.length).toBe(NUM_OF_SCHEDULERS);
  } catch (e) {
    if (firstQueue.type !== "bullmq") {
      expect(e).toBeInstanceOf(TRPCError);
      if (e instanceof TRPCError) {
        expect(e.code).toBe("BAD_REQUEST");
      }
    } else {
      throw e;
    }
  }
});

test("remove scheduler", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  try {
    const caller = appRouter.createCaller(ctx);

    const schedulers = await caller.scheduler.list({
      queueName: firstQueue.queue.name,
    });
    const scheduler = schedulers[0];

    await caller.scheduler.remove({
      queueName: firstQueue.queue.name,
      jobSchedulerId: scheduler.key,
    });

    const list = await caller.scheduler.list({
      queueName: firstQueue.queue.name,
    });

    expect(list.length).toBe(NUM_OF_SCHEDULERS - 1);
  } catch (e) {
    if (firstQueue.type !== "bullmq") {
      expect(e).toBeInstanceOf(TRPCError);
      if (e instanceof TRPCError) {
        expect(e.code).toBe("BAD_REQUEST");
      }
    } else {
      throw e;
    }
  }
});

test("bulk remove schedulers", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  try {
    const caller = appRouter.createCaller(ctx);

    const schedulers = await caller.scheduler.list({
      queueName: firstQueue.queue.name,
    });

    await caller.scheduler.bulkRemove({
      queueName: firstQueue.queue.name,
      jobSchedulerIds: schedulers.map((scheduler) => scheduler.key),
    });

    const list = await caller.scheduler.list({
      queueName: firstQueue.queue.name,
    });

    expect(list.length).toBe(0);
  } catch (e) {
    if (firstQueue.type !== "bullmq") {
      expect(e).toBeInstanceOf(TRPCError);
      if (e instanceof TRPCError) {
        expect(e.code).toBe("BAD_REQUEST");
      }
    } else {
      throw e;
    }
  }
});

// ============================================================================
// HIGH PRIORITY TESTS - Scheduler Add Functionality
// ============================================================================

test("add scheduler with cron pattern", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq") {
    const result = await caller.scheduler.add({
      queueName: firstQueue.queue.name,
      jobName: "cron-job",
      data: { type: "cron-scheduled" },
      pattern: "0 0 * * *", // Midnight daily
      tz: "America/Los_Angeles",
    });

    expect(result).toEqual({ success: true });

    // Verify it was added
    const schedulers = await caller.scheduler.list({
      queueName: firstQueue.queue.name,
    });

    const addedScheduler = schedulers.find(
      (s) => s.pattern === "0 0 * * *" && s.tz === "America/Los_Angeles",
    );
    expect(addedScheduler).toBeDefined();
  } else {
    // Non-BullMQ should throw error
    try {
      await caller.scheduler.add({
        queueName: firstQueue.queue.name,
        jobName: "cron-job",
        data: { type: "test" },
        pattern: "0 0 * * *",
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

test("add scheduler with interval", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq") {
    const result = await caller.scheduler.add({
      queueName: firstQueue.queue.name,
      jobName: "interval-job",
      data: { type: "interval-scheduled" },
      every: 300000, // Every 5 minutes
    });

    expect(result).toEqual({ success: true });

    // Verify it was added
    const schedulers = await caller.scheduler.list({
      queueName: firstQueue.queue.name,
    });

    const addedScheduler = schedulers.find((s) => s.every === 300000);
    expect(addedScheduler).toBeDefined();
  }
});

test("update scheduler uses BullMQ upsert semantics", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type !== "bullmq") {
    await expectTRPCError(
      () =>
        caller.scheduler.update({
          queueName: firstQueue.queue.name,
          key: "unsupported",
          template: { data: {} },
          opts: { every: 120_000 },
        }),
      "BAD_REQUEST",
    );
    return;
  }

  const schedulers = await caller.scheduler.list({
    queueName: firstQueue.queue.name,
  });
  const scheduler = schedulers[0];
  const result = await caller.scheduler.update({
    queueName: firstQueue.queue.name,
    key: scheduler.key,
    template: {
      name: "updated-job",
      data: { updated: true },
      opts: { attempts: 2 },
    },
    opts: { every: 120_000, tz: "UTC", limit: 5 },
  });

  expect(result).toEqual({ success: true });
  const updatedSchedulers = await caller.scheduler.list({
    queueName: firstQueue.queue.name,
  });
  const updated = updatedSchedulers.find((item) => item.key === scheduler.key);
  expect(updated).toMatchObject({
    every: 120_000,
    tz: "UTC",
    limit: 5,
    template: {
      data: { updated: true },
      opts: { attempts: 2 },
    },
  });
});

test("update scheduler does not create a missing scheduler", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type !== "bullmq") return;

  await expectTRPCError(
    () =>
      caller.scheduler.update({
        queueName: firstQueue.queue.name,
        key: "missing-scheduler",
        template: { data: { shouldNotExist: true } },
        opts: { every: 60_000 },
      }),
    "NOT_FOUND",
  );

  const schedulers = await caller.scheduler.list({
    queueName: firstQueue.queue.name,
  });
  expect(
    schedulers.some((scheduler) => scheduler.key === "missing-scheduler"),
  ).toBe(false);
});

test("add scheduler validation - requires pattern or every", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq") {
    try {
      await caller.scheduler.add({
        queueName: firstQueue.queue.name,
        jobName: "invalid-job",
        data: { type: "test" },
        // Neither pattern nor every provided
      });
      throw new Error("Should have thrown TRPCError");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      if (e instanceof TRPCError) {
        expect(e.code).toBe("BAD_REQUEST");
        expect(e.message).toContain("pattern");
      }
    }
  }
});

// ============================================================================
// MEDIUM PRIORITY TESTS - Error Scenarios
// ============================================================================

test("list schedulers on unsupported queue type", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type !== "bullmq") {
    try {
      await caller.scheduler.list({
        queueName: firstQueue.queue.name,
      });
      throw new Error("Should have thrown TRPCError");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      if (e instanceof TRPCError) {
        expect(e.code).toBe("BAD_REQUEST");
        expect(e.message).toContain("does not support");
      }
    }
  }
});

test("remove scheduler on unsupported queue type", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type !== "bullmq") {
    try {
      await caller.scheduler.remove({
        queueName: firstQueue.queue.name,
        jobSchedulerId: "fake-id",
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

test("remove non-existent scheduler", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq") {
    // Removing non-existent scheduler should not throw, just succeed silently
    const result = await caller.scheduler.remove({
      queueName: firstQueue.queue.name,
      jobSchedulerId: "non-existent-scheduler-id",
    });

    expect(result).toEqual({ success: true });
  }
});

test("bulk remove with non-existent scheduler IDs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq") {
    try {
      await caller.scheduler.bulkRemove({
        queueName: firstQueue.queue.name,
        jobSchedulerIds: ["non-existent-1", "non-existent-2"],
      });
      throw new Error("Should have thrown TRPCError");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      if (e instanceof TRPCError) {
        expect(e.code).toBe("NOT_FOUND");
        expect(e.message).toContain("No schedulers found");
      }
    }
  }
});

test("bulk remove returns removed schedulers", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq") {
    const schedulers = await caller.scheduler.list({
      queueName: firstQueue.queue.name,
    });

    if (schedulers.length > 0) {
      const idsToRemove = schedulers.slice(0, 2).map((s) => s.key);

      const result = await caller.scheduler.bulkRemove({
        queueName: firstQueue.queue.name,
        jobSchedulerIds: idsToRemove,
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(idsToRemove.length);
      expect(result[0]).toHaveProperty("key");
    }
  }
});

// ============================================================================
// LOW PRIORITY TESTS - Scheduler Info Verification
// ============================================================================

test("list schedulers returns correct structure", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq") {
    const schedulers = await caller.scheduler.list({
      queueName: firstQueue.queue.name,
    });

    expect(Array.isArray(schedulers)).toBe(true);

    if (schedulers.length > 0) {
      const scheduler = schedulers[0];
      expect(scheduler).toHaveProperty("key");
      expect(scheduler).toHaveProperty("name");
      expect(scheduler).toHaveProperty("template");

      // Should have either pattern or every
      const hasPattern = scheduler.pattern !== undefined;
      const hasEvery = scheduler.every !== undefined;
      expect(hasPattern || hasEvery).toBe(true);
    }
  }
});

test("scheduler template contains job data", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq") {
    const schedulers = await caller.scheduler.list({
      queueName: firstQueue.queue.name,
    });

    if (schedulers.length > 0) {
      const scheduler = schedulers[0];
      expect(scheduler.template).toBeDefined();
      expect(scheduler.template?.data).toBeDefined();
    }
  }
});
