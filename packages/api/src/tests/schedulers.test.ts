import { TRPCError } from "@trpc/server";
import type { Queue as BullMQQueue } from "bullmq";
import { expect, test, vi } from "vitest";

import { BullMQAdapter } from "../queue-adapters/bullmq.adapter";
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

test("legacy BullMQ repeatables reject updates and use legacy removal", async () => {
  const legacyKey = "legacy-job::1735689600000:UTC:0 0 * * *";
  const upsertJobScheduler = vi.fn();
  const removeJobScheduler = vi.fn();
  const removeRepeatableByKey = vi.fn().mockResolvedValue(true);
  const queue = {
    name: "legacy-repeatable",
    client: Promise.resolve({
      set: vi.fn().mockResolvedValue("OK"),
      eval: vi.fn().mockResolvedValue(1),
    }),
    toKey: (key: string) => `bull:legacy-repeatable:${key}`,
    getJobSchedulers: vi.fn().mockResolvedValue([
      {
        key: legacyKey,
        name: "legacy-job",
        id: null,
        pattern: "0 0 * * *",
      },
    ]),
    upsertJobScheduler,
    removeJobScheduler,
    removeRepeatableByKey,
  } as unknown as BullMQQueue;
  const caller = appRouter.createCaller({
    queues: [
      {
        queue,
        displayName: "Legacy repeatable",
        type: "bullmq",
      },
    ],
  });

  await expect(
    caller.scheduler.update({
      queueName: queue.name,
      key: legacyKey,
      template: { data: {} },
      opts: { every: 60_000 },
    }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: expect.stringContaining("Legacy BullMQ repeatable jobs"),
  });
  expect(upsertJobScheduler).not.toHaveBeenCalled();

  await expect(
    caller.scheduler.remove({
      queueName: queue.name,
      jobSchedulerId: legacyKey,
    }),
  ).resolves.toEqual({ success: true });
  expect(removeRepeatableByKey).toHaveBeenCalledWith(legacyKey);
  expect(removeJobScheduler).not.toHaveBeenCalled();
});

test("concurrent fixed-time scheduler adds use distinct identifiers", async () => {
  const upsertJobScheduler = vi.fn().mockResolvedValue({});
  const queue = {
    name: "concurrent-scheduler-add",
    upsertJobScheduler,
  } as unknown as BullMQQueue;
  const caller = appRouter.createCaller({
    queues: [
      {
        queue,
        displayName: "Concurrent scheduler add",
        type: "bullmq",
      },
    ],
  });

  await Promise.all([
    caller.scheduler.add({
      queueName: queue.name,
      jobName: "first",
      data: {},
      every: 60_000,
    }),
    caller.scheduler.add({
      queueName: queue.name,
      jobName: "second",
      data: {},
      every: 60_000,
    }),
  ]);

  const schedulerIds = upsertJobScheduler.mock.calls.map(([id]) => id);
  expect(schedulerIds).toHaveLength(2);
  expect(new Set(schedulerIds).size).toBe(2);
  expect(
    schedulerIds.every((id) => /^scheduler-[0-9a-f-]{36}$/u.test(id)),
  ).toBe(true);
});

test("scheduler editing stays disabled when presentation would redact data", async () => {
  const upsertJobScheduler = vi.fn();
  const queue = {
    name: "redacted-scheduler-update",
    getJobSchedulers: vi.fn().mockResolvedValue([{ key: "daily" }]),
    upsertJobScheduler,
  } as unknown as BullMQQueue;
  const caller = appRouter.createCaller({
    queues: [
      {
        queue,
        displayName: "Redacted scheduler update",
        type: "bullmq",
      },
    ],
    privacy: { redact: true },
  });

  await expectTRPCError(
    () =>
      caller.scheduler.update({
        queueName: queue.name,
        key: "daily",
        template: { data: { authorization: "secret" } },
        opts: { every: 60_000 },
      }),
    "BAD_REQUEST",
  );
  expect(upsertJobScheduler).not.toHaveBeenCalled();
});

test("long scheduler mutations renew their Redis lock", async () => {
  vi.useFakeTimers();
  const continueUpsert = deferred();
  const evalCommand = vi.fn(async (...args: unknown[]) =>
    args.length === 5 ? 1 : 1,
  );
  const queue = {
    name: "scheduler-lock-renewal",
    client: Promise.resolve({
      set: vi.fn().mockResolvedValue("OK"),
      eval: evalCommand,
    }),
    toKey: (key: string) => `bull:scheduler-lock-renewal:${key}`,
    getJobSchedulers: vi.fn().mockResolvedValue([{ key: "daily" }]),
    upsertJobScheduler: vi.fn(async () => continueUpsert.promise),
  } as unknown as BullMQQueue;
  const adapter = new BullMQAdapter(queue, "Lock renewal");

  try {
    const update = adapter.updateScheduler(
      "daily",
      { every: 60_000 },
      { data: {} },
    );
    await vi.waitFor(() => {
      expect(queue.upsertJobScheduler).toHaveBeenCalled();
    });
    await vi.advanceTimersByTimeAsync(10_001);
    expect(evalCommand.mock.calls.some((args) => args.length === 5)).toBe(true);
    continueUpsert.resolve();
    await expect(update).resolves.toBe(true);
    expect(evalCommand.mock.calls.some((args) => args.length === 4)).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test("scheduler removal cannot race an in-flight scheduler update", async () => {
  const upsertStarted = deferred();
  const continueUpsert = deferred();
  const removalWaitingForLock = deferred();
  let schedulerExists = true;
  let heldLockToken: string | undefined;
  let removeCalls = 0;

  const client = {
    set: async (...args: unknown[]) => {
      const token = String(args[1]);
      if (heldLockToken) {
        removalWaitingForLock.resolve();
        return null;
      }
      heldLockToken = token;
      return "OK";
    },
    eval: async (...args: unknown[]) => {
      const token = String(args[3]);
      if (heldLockToken === token) {
        heldLockToken = undefined;
        return 1;
      }
      return 0;
    },
  };
  const queue = {
    name: "scheduler-race",
    client: Promise.resolve(client),
    toKey: (key: string) => `bull:scheduler-race:${key}`,
    getJobSchedulers: async () =>
      schedulerExists ? [{ key: "daily-report" }] : [],
    upsertJobScheduler: async () => {
      upsertStarted.resolve();
      await continueUpsert.promise;
      schedulerExists = true;
      return {};
    },
    removeJobScheduler: async () => {
      removeCalls += 1;
      schedulerExists = false;
      return true;
    },
  } as unknown as BullMQQueue;
  const adapter = new BullMQAdapter(queue, "Scheduler race");

  const updatePromise = adapter.updateScheduler(
    "daily-report",
    { every: 60_000 },
    { name: "daily-report", data: {} },
  );
  await upsertStarted.promise;

  const removePromise = adapter.removeScheduler("daily-report");
  await removalWaitingForLock.promise;
  expect(removeCalls).toBe(0);

  continueUpsert.resolve();
  await expect(updatePromise).resolves.toBe(true);
  await removePromise;

  expect(removeCalls).toBe(1);
  expect(schedulerExists).toBe(false);
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

test("scheduler validation rejects pattern and every together", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "bullmq") return;
  const caller = appRouter.createCaller(ctx);

  const addError = await expectTRPCError(
    () =>
      caller.scheduler.add({
        queueName: firstQueue.queue.name,
        jobName: "ambiguous-scheduler",
        data: { type: "test" },
        pattern: "0 0 * * *",
        every: 60_000,
      }),
    "BAD_REQUEST",
  );
  expect(addError.message).toContain("exactly one");

  const scheduler = (
    await caller.scheduler.list({ queueName: firstQueue.queue.name })
  )[0];
  expect(scheduler).toBeDefined();
  if (!scheduler) return;

  const updateError = await expectTRPCError(
    () =>
      caller.scheduler.update({
        queueName: firstQueue.queue.name,
        key: scheduler.key,
        template: {
          name: scheduler.template?.name,
          data: scheduler.template?.data ?? {},
          opts: scheduler.template?.opts,
        },
        opts: {
          pattern: "0 0 * * *",
          every: 60_000,
        },
      }),
    "BAD_REQUEST",
  );
  expect(updateError.message).toContain("exactly one");
});

test("scheduler validation rejects cross-queue and internal options", async () => {
  const upsertJobScheduler = vi.fn();
  const queue = {
    name: "scheduler-option-policy",
    getJobSchedulers: vi.fn().mockResolvedValue([{ key: "daily" }]),
    upsertJobScheduler,
  } as unknown as BullMQQueue;
  const caller = appRouter.createCaller({
    queues: [
      {
        queue,
        displayName: "Scheduler option policy",
        type: "bullmq",
      },
    ],
  });
  const parent = {
    id: "parent-job",
    queue: "bull:hidden-queue",
  };

  await expectTRPCError(
    () =>
      caller.queue.addJobScheduler({
        queueName: queue.name,
        template: { data: {}, opts: { parent } },
        opts: { every: 60_000 },
      } as never),
    "BAD_REQUEST",
  );
  await expectTRPCError(
    () =>
      caller.scheduler.update({
        queueName: queue.name,
        key: "daily",
        template: { data: {}, opts: { parent } },
        opts: { every: 60_000 },
      } as never),
    "BAD_REQUEST",
  );
  await expectTRPCError(
    () =>
      caller.queue.addJobScheduler({
        queueName: queue.name,
        template: { data: {}, opts: { repeatJobKey: "internal" } },
        opts: { every: 60_000, prevMillis: Date.now() },
      } as never),
    "BAD_REQUEST",
  );

  expect(upsertJobScheduler).not.toHaveBeenCalled();
});

test("scheduler validation preserves safe BullMQ template options", async () => {
  const upsertJobScheduler = vi.fn();
  const queue = {
    name: "scheduler-template-compatibility",
    upsertJobScheduler,
  } as unknown as BullMQQueue;
  const caller = appRouter.createCaller({
    queues: [
      {
        queue,
        displayName: "Scheduler template compatibility",
        type: "bullmq",
      },
    ],
  });
  const template = {
    data: { source: "existing-scheduler" },
    opts: {
      timestamp: 1_700_000_000_000,
      failParentOnFailure: true,
      continueParentOnFailure: false,
      ignoreDependencyOnFailure: true,
      removeDependencyOnFailure: false,
      telemetry: { metadata: "trace-context", omitContext: false },
    },
  };

  await caller.queue.addJobScheduler({
    queueName: queue.name,
    template,
    opts: { every: 60_000 },
  });

  expect(upsertJobScheduler).toHaveBeenCalledWith(
    expect.any(String),
    { every: 60_000 },
    template,
  );
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

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
