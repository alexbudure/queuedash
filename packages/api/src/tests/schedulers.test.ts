import { appRouter } from "../routers/_app";
import { expect, test } from "vitest";
import { initRedisInstance, NUM_OF_SCHEDULERS } from "./test.utils";
import { TRPCError } from "@trpc/server";

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
