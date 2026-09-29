import { faker } from "@faker-js/faker";
import { expect, test, vi } from "vitest";

import { appRouter } from "../routers/_app";
import type { Context } from "../trpc";
import {
  expectTRPCError,
  initMultipleQueues,
  initRedisInstance,
  NUM_OF_COMPLETED_JOBS,
  NUM_OF_FAILED_JOBS,
  type,
} from "./test.utils";

type Caller = ReturnType<typeof appRouter.createCaller>;
type TestQueue = Awaited<ReturnType<typeof initRedisInstance>>["firstQueue"];

// The name the fixture's jobs were added under: Bull calls an unnamed job
// `__default__`.
const FIXTURE_JOB_NAME = type === "bull" ? "__default__" : "test";

// The fixture's workers may still be finishing: wait until every completed
// and failed job is where the tests expect it.
const waitForFixtures = async (caller: Caller, queueName: string) => {
  await vi.waitFor(
    async () => {
      const [completed, failed] = await Promise.all([
        caller.job.list({ queueName, status: "completed", limit: 50 }),
        caller.job.list({ queueName, status: "failed", limit: 50 }),
      ]);
      expect(completed.jobs).toHaveLength(NUM_OF_COMPLETED_JOBS);
      expect(failed.jobs).toHaveLength(NUM_OF_FAILED_JOBS);
    },
    { timeout: 10_000 },
  );
};

// The moment a finished job's range is judged by, as the router reads it.
const finishedTime = (job: {
  finishedAt: Date | null;
  processedAt: Date | null;
  createdAt: Date;
}) => (job.finishedAt ?? job.processedAt ?? job.createdAt).getTime();

const addDeduplicatedJob = async (
  firstQueue: TestQueue,
  deduplicationId: string,
): Promise<string> => {
  if (firstQueue.type !== "bullmq") throw new Error("BullMQ only");
  const job = await firstQueue.queue.add(
    "dedupe",
    { deduplicationId },
    // Delayed, so no worker finishes it and releases the id first.
    { delay: 60_000, deduplication: { id: deduplicationId } },
  );
  return String(job.id);
};

test("a date range keeps just the finished jobs it covers", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const queueName = firstQueue.queue.name;
  await waitForFixtures(caller, queueName);

  const { jobs } = await caller.job.list({
    queueName,
    status: "failed",
    limit: 50,
  });
  const times = jobs.map(finishedTime).sort((left, right) => left - right);
  const from = times[0] ?? 0;
  const to = times[Math.floor(times.length / 2)] ?? 0;
  const expected = times.filter((time) => time >= from && time <= to).length;

  const page = await caller.job.list({
    queueName,
    status: "failed",
    limit: 50,
    from,
    to,
  });
  expect(page.totalCount).toBe(expected);
  expect(page.jobs).toHaveLength(expected);
  for (const job of page.jobs) {
    expect(finishedTime(job)).toBeGreaterThanOrEqual(from);
    expect(finishedTime(job)).toBeLessThanOrEqual(to);
  }

  // Nothing finished before the fixture existed.
  const empty = await caller.job.list({
    queueName,
    status: "failed",
    limit: 50,
    to: from - 1,
  });
  expect(empty.totalCount).toBe(0);
  expect(empty.jobs).toHaveLength(0);
});

test("a date range pages through its jobs without repeats", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const queueName = firstQueue.queue.name;
  await waitForFixtures(caller, queueName);

  const from = Date.now() - 60 * 60_000;
  const first = await caller.job.list({
    queueName,
    status: "failed",
    limit: 5,
    from,
  });
  expect(first.totalCount).toBe(NUM_OF_FAILED_JOBS);
  const ids = first.jobs.map(({ id }) => id);
  let cursor = first.nextCursor;
  while (cursor !== undefined) {
    const next = await caller.job.list({
      queueName,
      status: "failed",
      limit: 5,
      cursor,
      from,
    });
    ids.push(...next.jobs.map(({ id }) => id));
    cursor = next.nextCursor;
  }
  expect(ids).toHaveLength(NUM_OF_FAILED_JOBS);
  expect(new Set(ids).size).toBe(NUM_OF_FAILED_JOBS);
});

test("a relative range is measured from when the request runs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const queueName = firstQueue.queue.name;
  await waitForFixtures(caller, queueName);

  const lastHour = await caller.job.list({
    queueName,
    status: "failed",
    limit: 50,
    fromOffset: -60 * 60_000,
  });
  expect(lastHour.totalCount).toBe(NUM_OF_FAILED_JOBS);

  // Ended an hour ago, and an offset wins over a moment for the same end.
  const endedEarlier = await caller.job.list({
    queueName,
    status: "failed",
    limit: 50,
    to: Date.now() + 60_000,
    toOffset: -60 * 60_000,
  });
  expect(endedEarlier.totalCount).toBe(0);

  const removed = await caller.job.bulkRemoveByFilter({
    queueName,
    status: "failed",
    toOffset: -60 * 60_000,
  });
  expect(removed.matched).toBe(0);
});

test("a date range combines with the other filters and bulk actions", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const queueName = firstQueue.queue.name;
  await waitForFixtures(caller, queueName);

  const from = Date.now() - 60 * 60_000;
  const filtered = await caller.job.list({
    queueName,
    status: "failed",
    limit: 50,
    from,
    query: "Generic error",
  });
  expect(filtered.totalCount).toBe(NUM_OF_FAILED_JOBS);

  // A range that ended before the fixture: nothing to act on.
  const before = await caller.job.bulkRemoveByFilter({
    queueName,
    status: "failed",
    to: from,
  });
  expect(before.matched).toBe(0);

  if (firstQueue.type === "bull" || firstQueue.type === "bullmq") {
    const retried = await caller.job.bulkRetryByFilter({
      queueName,
      status: "failed",
      from,
    });
    expect(retried.succeeded).toBe(NUM_OF_FAILED_JOBS);
  }
});

test("a job name filters the list", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const queueName = firstQueue.queue.name;
  await waitForFixtures(caller, queueName);
  const queue = await caller.queue.byName({ queueName });
  expect(queue.supports.jobNames).toBe(type === "bull" || type === "bullmq");
  if (!queue.supports.jobNames) return;

  const [named, other] = await Promise.all([
    caller.job.list({
      queueName,
      status: "failed",
      limit: 50,
      name: FIXTURE_JOB_NAME,
    }),
    caller.job.list({ queueName, status: "failed", limit: 50, name: "other" }),
  ]);
  expect(named.totalCount).toBe(NUM_OF_FAILED_JOBS);
  expect(other.totalCount).toBe(0);
});

test("delayed jobs say when they are due", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const queueName = firstQueue.queue.name;
  if (firstQueue.type !== "bullmq" && firstQueue.type !== "bull") return;

  const before = Date.now();
  const job =
    firstQueue.type === "bullmq"
      ? await firstQueue.queue.add("later", { later: true }, { delay: 60_000 })
      : await firstQueue.queue.add({ later: true }, { delay: 60_000 });
  const jobId = String(job.id);

  const { jobs } = await caller.job.list({
    queueName,
    status: "delayed",
    limit: 50,
  });
  const listed = jobs.find(({ id }) => id === jobId);
  expect(listed?.runAt?.getTime()).toBeGreaterThanOrEqual(before + 60_000);
  expect(listed?.runAt?.getTime()).toBeLessThan(Date.now() + 60_001);

  const byId = await caller.job.byId({ queueName, jobId });
  expect(byId?.runAt?.getTime()).toBe(listed?.runAt?.getTime());
});

test("editing a job's data saves it on the same job, and can retry it", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const queueName = firstQueue.queue.name;
  await waitForFixtures(caller, queueName);
  const queue = await caller.queue.byName({ queueName });
  const {
    jobs: [failed],
  } = await caller.job.list({ queueName, status: "failed", limit: 1 });
  if (!failed) throw new Error("The fixture has no failed job");

  expect(queue.supports.updateData).toBe(type === "bull" || type === "bullmq");
  if (!queue.supports.updateData) {
    await expectTRPCError(
      () => caller.job.updateData({ queueName, jobId: failed.id, data: {} }),
      "BAD_REQUEST",
    );
    return;
  }

  // The fixture fails every job past the completed ones, so an index in
  // range is the fix.
  const data = { index: NUM_OF_COMPLETED_JOBS, note: faker.string.uuid() };
  const saved = await caller.job.updateData({
    queueName,
    jobId: failed.id,
    data,
    retry: true,
  });
  expect(saved.id).toBe(failed.id);
  expect(saved.data).toEqual(data);
  await vi.waitFor(async () => {
    const reread = await caller.job.byId({ queueName, jobId: failed.id });
    expect(reread?.status).toBe("completed");
    expect(reread?.data).toEqual(data);
  }, 4_000);
});

test("job data can't be edited while it is redacted or hidden", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const queueName = firstQueue.queue.name;
  const plain = appRouter.createCaller(ctx);
  await waitForFixtures(plain, queueName);
  const {
    jobs: [failed],
  } = await plain.job.list({ queueName, status: "failed", limit: 1 });
  if (!failed) throw new Error("The fixture has no failed job");

  for (const privacy of [
    { redact: true },
    { expose: { jobData: false } },
  ] satisfies Context["privacy"][]) {
    const caller = appRouter.createCaller({ ...ctx, privacy });
    const queue = await caller.queue.byName({ queueName });
    expect(queue.supports.updateData).toBe(false);
    await expectTRPCError(
      () =>
        caller.job.updateData({
          queueName,
          jobId: failed.id,
          data: { overwritten: true },
        }),
      "BAD_REQUEST",
    );
  }
  const unchanged = await plain.job.byId({ queueName, jobId: failed.id });
  expect(unchanged?.data).toEqual(failed.data);
});

test("editing is an action access rules can deny", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const queueName = firstQueue.queue.name;
  const caller = appRouter.createCaller({
    ...ctx,
    access: {
      rules: [
        {
          queues: [queueName],
          deny: ["job.update", "job.changeDelay", "queue.setRateLimit"],
        },
      ],
    },
  });
  const queue = await caller.queue.byName({ queueName });
  expect(queue.access.actions["job.update"]).toBe(false);
  expect(queue.access.actions["job.changeDelay"]).toBe(false);
  expect(queue.access.actions["queue.setRateLimit"]).toBe(false);
  expect(queue.access.actions["job.changePriority"]).toBe(true);
  await expectTRPCError(
    () => caller.job.updateData({ queueName, jobId: "1", data: {} }),
    "FORBIDDEN",
  );
  await expectTRPCError(
    () =>
      caller.queue.setRateLimit({
        queueName,
        limit: { max: 1, duration: 1_000 },
      }),
    "FORBIDDEN",
  );
});

test("a delayed job can be moved and reprioritized", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const queueName = firstQueue.queue.name;
  const queue = await caller.queue.byName({ queueName });
  if (firstQueue.type !== "bullmq") {
    expect(queue.supports.changeDelay).toBe(false);
    expect(queue.supports.changePriority).toBe(false);
    await expectTRPCError(
      () => caller.job.changeDelay({ queueName, jobId: "1", runAt: 0 }),
      "BAD_REQUEST",
    );
    return;
  }

  const job = await firstQueue.queue.add("later", {}, { delay: 60_000 });
  const jobId = String(job.id);
  const runAt = Date.now() + 10 * 60_000;
  const moved = await caller.job.changeDelay({ queueName, jobId, runAt });
  expect(Math.abs((moved.runAt?.getTime() ?? 0) - runAt)).toBeLessThan(1_000);

  await caller.job.changePriority({ queueName, jobId, priority: 5 });
  expect((await firstQueue.queue.getJob(jobId))?.priority).toBe(5);
  // The priority it runs at now, not the one it was added with.
  expect((await caller.job.byId({ queueName, jobId }))?.priority).toBe(5);

  // Only delayed jobs move; the finished ones stay put.
  await vi.waitFor(async () => {
    const { jobs } = await caller.job.list({
      queueName,
      status: "completed",
      limit: 1,
    });
    expect(jobs).toHaveLength(1);
  });
  const {
    jobs: [completed],
  } = await caller.job.list({ queueName, status: "completed", limit: 1 });
  await expectTRPCError(
    () =>
      caller.job.changeDelay({ queueName, jobId: completed?.id ?? "", runAt }),
    "BAD_REQUEST",
  );
  await expectTRPCError(
    () =>
      caller.job.changePriority({
        queueName,
        jobId: completed?.id ?? "",
        priority: 1,
      }),
    "BAD_REQUEST",
  );
});

test("releasing a deduplication id lets the same id in again", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const queueName = firstQueue.queue.name;
  const queue = await caller.queue.byName({ queueName });
  expect(queue.supports.deduplication).toBe(type === "bullmq");
  if (!queue.supports.deduplication) return;

  const deduplicationId = `dedupe-${faker.string.uuid()}`;
  const first = await addDeduplicatedJob(firstQueue, deduplicationId);
  // Held: a second job with the id is the first one again.
  expect(await addDeduplicatedJob(firstQueue, deduplicationId)).toBe(first);
  const job = await caller.job.byId({ queueName, jobId: first });
  expect(job?.deduplicationId).toBe(deduplicationId);

  await expect(
    caller.job.removeDeduplication({ queueName, jobId: first }),
  ).resolves.toEqual({ released: true });
  expect(await addDeduplicatedJob(firstQueue, deduplicationId)).not.toBe(first);
});

test("a queue's global limits can be set, read and removed", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const queueName = firstQueue.queue.name;
  const queue = await caller.queue.byName({ queueName });
  expect(queue.supports.concurrencyLimit).toBe(type === "bullmq");
  expect(queue.supports.rateLimit).toBe(type === "bullmq");
  if (!queue.supports.concurrencyLimit && !queue.supports.rateLimit) {
    await expect(caller.queue.limits({ queueName })).resolves.toBeNull();
    await expectTRPCError(
      () => caller.queue.setConcurrency({ queueName, concurrency: 1 }),
      "BAD_REQUEST",
    );
    return;
  }

  await expect(caller.queue.limits({ queueName })).resolves.toEqual({
    concurrency: null,
    rateLimit: null,
    rateLimitedForMs: 0,
  });
  if (queue.supports.concurrencyLimit) {
    await caller.queue.setConcurrency({ queueName, concurrency: 3 });
    expect((await caller.queue.limits({ queueName }))?.concurrency).toBe(3);
    await caller.queue.setConcurrency({ queueName, concurrency: null });
    expect((await caller.queue.limits({ queueName }))?.concurrency).toBeNull();
  }
  if (queue.supports.rateLimit) {
    await caller.queue.setRateLimit({
      queueName,
      limit: { max: 5, duration: 1_000 },
    });
    expect((await caller.queue.limits({ queueName }))?.rateLimit).toEqual({
      max: 5,
      duration: 1_000,
    });
    await caller.queue.clearRateLimit({ queueName });
    expect((await caller.queue.limits({ queueName }))?.rateLimitedForMs).toBe(
      0,
    );
    await caller.queue.setRateLimit({ queueName, limit: null });
    expect((await caller.queue.limits({ queueName }))?.rateLimit).toBeNull();
  }
});

test("job types count, fail and time each job name", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const queueName = firstQueue.queue.name;
  await waitForFixtures(caller, queueName);
  const queue = await caller.queue.byName({ queueName });
  if (!queue.supports.jobNames) {
    await expectTRPCError(
      () => caller.job.types({ queueName, minutes: 60 }),
      "BAD_REQUEST",
    );
    return;
  }

  const { types } = await caller.job.types({ queueName, minutes: 60 });
  const fixture = types.find(({ name }) => name === FIXTURE_JOB_NAME);
  expect(fixture).toMatchObject({
    completed: NUM_OF_COMPLETED_JOBS,
    failed: NUM_OF_FAILED_JOBS,
  });
  expect(fixture?.failureRate).toBeCloseTo(
    NUM_OF_FAILED_JOBS / (NUM_OF_COMPLETED_JOBS + NUM_OF_FAILED_JOBS),
  );
  expect(fixture?.p50).not.toBeNull();
  expect(fixture?.p95).toBeGreaterThanOrEqual(fixture?.p50 ?? 0);
});

test("find looks for a job in every queue", async () => {
  const { ctx } = await initMultipleQueues(2);
  const caller = appRouter.createCaller(ctx);
  const [first, second] = ctx.queues;
  if (!first || !second) throw new Error("The fixture has two queues");
  await waitForFixtures(caller, first.queue.name);
  await waitForFixtures(caller, second.queue.name);

  const {
    jobs: [failed],
  } = await caller.job.list({
    queueName: second.queue.name,
    status: "failed",
    limit: 1,
  });
  if (!failed) throw new Error("The fixture has no failed job");

  // By id: every queue's job with that id, the exact matches first.
  const byId = await caller.job.find({ query: failed.id });
  expect(byId.results[0]?.job.id).toBe(failed.id);
  expect(
    byId.results.some(
      ({ job, queueName }) =>
        job.id === failed.id && queueName === second.queue.name,
    ),
  ).toBe(true);

  // By text: both queues' failures carry the same error.
  const byText = await caller.job.find({ query: "Generic error", limit: 50 });
  const queues = new Set(byText.results.map(({ queueName }) => queueName));
  expect(queues).toEqual(new Set([first.queue.name, second.queue.name]));
});

test("find is refused while job ids are redacted", async () => {
  const { ctx } = await initRedisInstance();
  const caller = appRouter.createCaller({
    ...ctx,
    privacy: { redact: { keys: ["id"] } },
  });
  await expectTRPCError(() => caller.job.find({ query: "1" }), "FORBIDDEN");
});
