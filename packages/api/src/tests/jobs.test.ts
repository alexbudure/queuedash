import { appRouter } from "../routers/_app";
import { expect, test } from "vitest";
import {
  initRedisInstance,
  NUM_OF_COMPLETED_JOBS,
  NUM_OF_FAILED_JOBS,
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
      retriedAt: expect.any(Date),
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

// TODO:
// promote job
// discard job
