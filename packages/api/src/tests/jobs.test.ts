import { appRouter } from "../routers/_app";
import { expect, test } from "vitest";
import {
  initRedisInstance,
  NUM_OF_COMPLETED_JOBS,
  NUM_OF_FAILED_JOBS,
  NUM_OF_WAITING_CHILDREN_JOBS,
  sleep,
  type,
} from "./test.utils";
import { TRPCError } from "@trpc/server";

test("list completed jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const list = await caller.job.list({
    limit: 10,
    cursor: 0,
    status: "completed",
    queueName: firstQueue.queue.name,
  });

  expect(list.totalCount).toBe(NUM_OF_COMPLETED_JOBS);
});

test("retry job", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  try {
    const { jobs } = await caller.job.list({
      limit: 10,
      cursor: 0,
      status: "failed",
      queueName: firstQueue.queue.name,
    });

    const job = jobs[0];

    const newJob = await caller.job.retry({
      queueName: firstQueue.queue.name,
      jobId: job.id,
    });
    expect(newJob).toMatchObject({
      id: job.id,
      ...(firstQueue.type === "bull" && { retriedAt: expect.any(Date) }),
    });
  } catch (e) {
    expect(e).toBeInstanceOf(TRPCError);
    expect(type).toBe("bee");
    if (e instanceof TRPCError) {
      expect(e.code).toBe("BAD_REQUEST");
    }
  }
});

test("remove job", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const { jobs } = await caller.job.list({
    limit: 10,
    cursor: 0,
    status: "failed",
    queueName: firstQueue.queue.name,
  });

  const job = jobs[0];

  await caller.job.remove({
    queueName: firstQueue.queue.name,
    jobId: job.id,
  });

  const list = await caller.job.list({
    limit: 10,
    cursor: 0,
    status: "failed",
    queueName: firstQueue.queue.name,
  });

  expect(list.totalCount).toBe(NUM_OF_FAILED_JOBS - 1);
});

test("bulk remove job", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const { jobs } = await caller.job.list({
    limit: 10,
    cursor: 0,
    status: "failed",
    queueName: firstQueue.queue.name,
  });

  await caller.job.bulkRemove({
    queueName: firstQueue.queue.name,
    jobIds: jobs.map((job) => job.id),
  });

  const list = await caller.job.list({
    limit: 10,
    cursor: 0,
    status: "failed",
    queueName: firstQueue.queue.name,
  });

  expect(list.totalCount).toBe(0);
});

test("rerun job", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const { jobs } = await caller.job.list({
    limit: 10,
    cursor: 0,
    status: "completed",
    queueName: firstQueue.queue.name,
  });

  const job = jobs[0];

  await caller.job.rerun({
    queueName: firstQueue.queue.name,
    jobId: job.id,
  });

  await sleep(200);

  const list = await caller.job.list({
    limit: 10,
    cursor: 0,
    status: "completed",
    queueName: firstQueue.queue.name,
  });

  expect(list.totalCount).toBe(NUM_OF_COMPLETED_JOBS + 1);
});

test("list waiting-children jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const list = await caller.job.list({
    limit: 10,
    cursor: 0,
    status: "waiting-children",
    queueName: firstQueue.queue.name,
  });

  if (type === "bullmq") {
    expect(list.totalCount).toBe(NUM_OF_WAITING_CHILDREN_JOBS);
  } else {
    // Bull and Bee don't support waiting-children status
    expect(list.totalCount).toBe(0);
  }
});

test("promote job", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (type === "bullmq") {
    // Add a delayed job to promote
    const queueInCtx = ctx.queues[0];
    if (queueInCtx.type === "bullmq") {
      await queueInCtx.queue.add(
        "delayed-job",
        { test: "data" },
        { delay: 5000 },
      );
    }

    await sleep(100);

    const { jobs } = await caller.job.list({
      limit: 10,
      cursor: 0,
      status: "delayed",
      queueName: firstQueue.queue.name,
    });

    const job = jobs[0];

    await caller.job.promote({
      queueName: firstQueue.queue.name,
      jobId: job.id,
    });

    const waitingList = await caller.job.list({
      limit: 10,
      cursor: 0,
      status: "waiting",
      queueName: firstQueue.queue.name,
    });

    expect(waitingList.jobs.some((j) => j.id === job.id)).toBe(true);
  } else {
    try {
      await caller.job.promote({
        queueName: firstQueue.queue.name,
        jobId: "fake-id",
      });
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      if (e instanceof TRPCError) {
        expect(e.code).toBe("BAD_REQUEST");
      }
    }
  }
});

test("get job logs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (type === "bullmq") {
    const { jobs } = await caller.job.list({
      limit: 10,
      cursor: 0,
      status: "completed",
      queueName: firstQueue.queue.name,
    });

    const job = jobs[0];

    const logs = await caller.job.logs({
      queueName: firstQueue.queue.name,
      jobId: job.id,
    });

    expect(logs).toBeDefined();
    expect(Array.isArray(logs)).toBe(true);
  } else {
    const logs = await caller.job.logs({
      queueName: firstQueue.queue.name,
      jobId: "fake-id",
    });

    expect(logs).toBeNull();
  }
});
