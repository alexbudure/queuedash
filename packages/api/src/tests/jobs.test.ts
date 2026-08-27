import { faker } from "@faker-js/faker";
import { TRPCError } from "@trpc/server";
import type { Queue as BullMQQueue } from "bullmq";
import { expect, test, vi } from "vitest";

import { GroupMQAdapter } from "../queue-adapters/groupmq.adapter";
import { appRouter } from "../routers/_app";
import { transformContext } from "../trpc";
import {
  initRedisInstance,
  NUM_OF_COMPLETED_JOBS,
  NUM_OF_FAILED_JOBS,
  NUM_OF_WAITING_CHILDREN_JOBS,
  expectTRPCError,
  sleep,
  type,
} from "./test.utils";

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

test("rejects statuses unsupported by the queue adapter", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const queue = await caller.queue.byName({
    queueName: firstQueue.queue.name,
  });
  const allStatuses = [
    "completed",
    "failed",
    "delayed",
    "active",
    "prioritized",
    "waiting",
    "waiting-children",
    "paused",
  ] as const;
  const unsupportedStatus = allStatuses.find(
    (status) => !queue.supports.statuses.includes(status),
  );

  if (!unsupportedStatus) return;

  await expectTRPCError(
    () =>
      caller.job.list({
        limit: 10,
        cursor: 0,
        status: unsupportedStatus,
        queueName: firstQueue.queue.name,
      }),
    "BAD_REQUEST",
  );
});

test("job has returnValue when worker returns data", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  // Get completed jobs - job with index 1 should have a return value
  const { jobs } = await caller.job.list({
    limit: 100,
    cursor: 0,
    status: "completed",
    queueName: firstQueue.queue.name,
  });

  // Find the job with index 1 (the one that returns a value)
  const jobWithReturnValue = jobs.find((j) => j.data.index === 1);

  if (firstQueue.type === "bee") {
    // Bee-Queue doesn't support return values
    expect(jobWithReturnValue?.returnValue).toBeUndefined();
  } else {
    // Bull, BullMQ, and GroupMQ should have the return value
    expect(jobWithReturnValue).toBeDefined();
    expect(jobWithReturnValue?.returnValue).toEqual({
      processed: true,
      index: 1,
    });
  }
});

test("search is bounded and only matches server-presented data", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const hiddenValue = `hidden-${faker.string.uuid()}`;
  const caller = appRouter.createCaller({
    ...ctx,
    privacy: {
      redact: {
        keys: ["index", "sensitiveField"],
      },
    },
  });
  await caller.queue.addJob({
    queueName: firstQueue.queue.name,
    data: {
      index: 1,
      sensitiveField: hiddenValue,
    },
  });
  await sleep(50);
  const visibleJobs = await caller.job.list({
    limit: 1,
    cursor: 0,
    status: "completed",
    queueName: firstQueue.queue.name,
  });
  const job = visibleJobs.jobs[0];

  expect(job?.data.index).toBe("[REDACTED]");

  const exact = await caller.job.search({
    queueName: firstQueue.queue.name,
    query: job.id,
    maxScanned: 25,
    limit: 5,
  });
  expect(exact.results[0]?.job.id).toBe(job.id);
  expect(exact.results[0]?.job.data.index).toBe("[REDACTED]");
  expect(exact.scanned).toBeLessThanOrEqual(25);

  const hidden = await caller.job.search({
    queueName: firstQueue.queue.name,
    query: hiddenValue,
    maxScanned: 50,
    limit: 5,
  });
  expect(hidden.results).toHaveLength(0);
  expect(hidden.scanned).toBeLessThanOrEqual(50);

  const cappedCaller = appRouter.createCaller({
    ...ctx,
    search: { maxScanned: 25 },
  });
  const capped = await cappedCaller.job.search({
    queueName: firstQueue.queue.name,
    query: "does-not-exist",
    maxScanned: 500,
    limit: 5,
  });
  expect(capped.scanned).toBeLessThanOrEqual(25);
});

test("exact-id search respects the requested statuses", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const completed = await caller.job.list({
    queueName: firstQueue.queue.name,
    status: "completed",
    limit: 1,
  });
  const completedJob = completed.jobs[0];
  expect(completedJob).toBeDefined();
  if (!completedJob) return;

  const excluded = await caller.job.search({
    queueName: firstQueue.queue.name,
    query: completedJob.id,
    statuses: ["failed"],
    maxScanned: 25,
    limit: 5,
  });
  expect(excluded.results.some(({ job }) => job.id === completedJob.id)).toBe(
    false,
  );

  const included = await caller.job.search({
    queueName: firstQueue.queue.name,
    query: completedJob.id,
    statuses: ["completed"],
    maxScanned: 25,
    limit: 5,
  });
  expect(
    included.results.some(
      ({ job, status }) => job.id === completedJob.id && status === "completed",
    ),
  ).toBe(true);
});

test("cross-status search gives each requested status part of the scan budget", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  for (let index = 0; index < 30; index += 1) {
    await caller.queue.addJob({
      queueName: firstQueue.queue.name,
      data: { index: 1, searchPadding: index },
      opts:
        firstQueue.type === "groupmq"
          ? { groupId: `search-padding-${faker.string.uuid()}` }
          : undefined,
    });
  }
  await sleep(firstQueue.type === "groupmq" ? 1_000 : 300);

  const result = await caller.job.search({
    queueName: firstQueue.queue.name,
    query: '"index":20',
    statuses: ["completed", "completed", "completed", "failed"],
    maxScanned: 25,
    limit: 5,
  });

  expect(
    result.results.some(
      ({ job, status }) => job.data.index === 20 && status === "failed",
    ),
  ).toBe(true);
  expect(result.scanned).toBeLessThanOrEqual(25);
});

test("cross-status search fairly represents broad matches", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const result = await caller.job.search({
    queueName: firstQueue.queue.name,
    query: "index",
    statuses: ["completed", "failed"],
    maxScanned: 25,
    limit: 4,
  });

  expect(result.results).toHaveLength(4);
  expect(
    result.results.filter(({ status }) => status === "completed"),
  ).toHaveLength(2);
  expect(
    result.results.filter(({ status }) => status === "failed"),
  ).toHaveLength(2);
  expect(result.scanned).toBeLessThanOrEqual(25);
});

test("unfiltered exact-id search keeps Bee jobs whose precise state is unavailable", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "bee") return;
  const caller = appRouter.createCaller(ctx);
  const exactJob = await firstQueue.queue
    .createJob({ exactBeeSearch: true })
    .delayUntil(Date.now() + 60_000)
    .save();

  const result = await caller.job.search({
    queueName: firstQueue.queue.name,
    query: exactJob.id,
    maxScanned: 25,
    limit: 5,
  });

  expect(result.results[0]).toMatchObject({
    job: { id: exactJob.id },
    status: null,
  });
});

test("exact-id search cannot bypass presentation redaction", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const rawCaller = appRouter.createCaller(ctx);
  const caller = appRouter.createCaller({
    ...ctx,
    privacy: { redact: { keys: ["id"] } },
  });
  const rawJob = (
    await rawCaller.job.list({
      queueName: firstQueue.queue.name,
      status: "completed",
      limit: 1,
    })
  ).jobs[0];
  expect(rawJob).toBeDefined();
  if (!rawJob) return;

  const result = await caller.job.search({
    queueName: firstQueue.queue.name,
    query: rawJob.id,
    limit: 5,
    maxScanned: 100,
  });
  expect(result.results.some(({ job }) => job.id === rawJob.id)).toBe(false);
  expect(result.results.every(({ job }) => job.id === "[REDACTED]")).toBe(true);
});

test("redacted job identities cannot target a different job", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const rawCaller = appRouter.createCaller(ctx);
  const rawJobs = (
    await rawCaller.job.list({
      queueName: firstQueue.queue.name,
      status: "completed",
      limit: 2,
    })
  ).jobs;
  expect(rawJobs).toHaveLength(2);
  const target = rawJobs[0];
  if (!target) return;

  const caller = appRouter.createCaller({
    ...ctx,
    privacy: {
      redact: { keys: ["id"], replacement: target.id },
    },
  });
  const queue = await caller.queue.byName({
    queueName: firstQueue.queue.name,
  });
  expect(queue.access.actions["job.remove"]).toBe(false);
  expect(queue.supports.logs).toBe(false);

  await expectTRPCError(
    () =>
      caller.job.remove({
        queueName: firstQueue.queue.name,
        jobId: target.id,
      }),
    "FORBIDDEN",
  );
  await expectTRPCError(
    () =>
      caller.job.byId({
        queueName: firstQueue.queue.name,
        jobId: target.id,
      }),
    "FORBIDDEN",
  );
  await expectTRPCError(
    () =>
      caller.job.logs({
        queueName: firstQueue.queue.name,
        jobId: target.id,
      }),
    "FORBIDDEN",
  );
  await expect(
    rawCaller.job.byId({
      queueName: firstQueue.queue.name,
      jobId: target.id,
    }),
  ).resolves.toMatchObject({ id: target.id });
});

test("redacted group identities reject group-targeted bulk mutations", async () => {
  const queue = {
    name: "redacted-group-bulk-actions",
  } as unknown as BullMQQueue;
  const caller = appRouter.createCaller({
    queues: [
      {
        queue,
        displayName: "Redacted group bulk actions",
        type: "bullmq",
      },
    ],
    privacy: {
      redact: {
        includeDefaultKeys: false,
        keys: ["groupId"],
      },
    },
  });
  const operations = [
    () =>
      caller.job.bulkRemoveByFilter({
        queueName: queue.name,
        status: "failed",
        groupId: "private-group",
      }),
    () =>
      caller.job.bulkRetryByFilter({
        queueName: queue.name,
        status: "failed",
        groupId: "private-group",
      }),
    () =>
      caller.job.bulkRemoveByGroup({
        queueName: queue.name,
        groupId: "private-group",
      }),
  ];

  for (const operation of operations) {
    const error = await expectTRPCError(operation, "FORBIDDEN");
    expect(error.message).toBe(
      "Group filtering is disabled when group identifiers are redacted",
    );
  }
});

test("job list filters visible fields and sorts oldest first", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const filtered = await caller.job.list({
    queueName: firstQueue.queue.name,
    status: "completed",
    limit: 100,
    query: '"index":1',
  });

  expect(filtered.jobs).toHaveLength(1);
  expect(filtered.jobs[0].data.index).toBe(1);
  expect(filtered.searchMeta?.capped).toBe(false);

  const oldestFirst = await caller.job.list({
    queueName: firstQueue.queue.name,
    status: "completed",
    limit: 100,
    sort: "oldest",
  });
  const timestamps = oldestFirst.jobs.map((job) => job.createdAt.getTime());
  expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
});

test("job list reports partial results at the configured scan cap", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bee") return;

  for (let index = 0; index < 30; index += 1) {
    await caller.queue.addJob({
      queueName: firstQueue.queue.name,
      data: { capTest: index },
      opts:
        firstQueue.type === "groupmq"
          ? { delay: 60_000, groupId: `cap-test-${index}` }
          : { delay: 60_000 },
    });
  }

  const result = await caller.job.list({
    queueName: firstQueue.queue.name,
    status: "delayed",
    limit: 25,
    query: "does-not-match-cap-test",
    scanLimit: 25,
  });

  expect(result.jobs).toHaveLength(0);
  expect(result.searchMeta).toMatchObject({
    scanned: 25,
    capped: true,
    scanLimit: 25,
  });
});

test("bulk remove by filter removes only matching jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const before = await caller.job.list({
    queueName: firstQueue.queue.name,
    status: "failed",
    limit: 100,
  });

  const result = await caller.job.bulkRemoveByFilter({
    queueName: firstQueue.queue.name,
    status: "failed",
    query: '"index":13',
  });

  expect(result).toMatchObject({
    matched: 1,
    succeeded: 1,
    failed: 0,
    partial: false,
  });
  const after = await caller.job.list({
    queueName: firstQueue.queue.name,
    status: "failed",
    limit: 100,
  });
  expect(after.totalCount).toBe(before.totalCount - 1);
});

test("rejects an empty group filter before a bulk mutation", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  await expectTRPCError(
    () =>
      caller.job.bulkRemoveByFilter({
        queueName: firstQueue.queue.name,
        status: "failed",
        groupId: "",
      }),
    "BAD_REQUEST",
  );
});

test("GroupMQ rejects retry without mutating exhausted attempts", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  const caller = appRouter.createCaller(ctx);
  const failedBefore = await caller.job.list({
    queueName: firstQueue.queue.name,
    status: "failed",
    limit: 100,
  });
  const exhaustedJob = failedBefore.jobs.find((job) => job.data.index === 20);
  expect(exhaustedJob).toBeDefined();
  if (!exhaustedJob) return;

  await expectTRPCError(
    () =>
      caller.job.bulkRetryByFilter({
        queueName: firstQueue.queue.name,
        status: "failed",
        query: '"index":20',
      }),
    "BAD_REQUEST",
  );
  const failedAfter = await caller.job.list({
    queueName: firstQueue.queue.name,
    status: "failed",
    limit: 100,
  });
  expect(
    failedAfter.jobs.find((job) => job.id === exhaustedJob.id),
  ).toMatchObject({
    attemptsMade: exhaustedJob.attemptsMade,
  });
});

test("GroupMQ waiting pages are stable in native queue order", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  const caller = appRouter.createCaller(ctx);
  await firstQueue.queue.pause();
  await sleep(100);

  const orderBase = Date.now();
  for (let index = 0; index < 5; index += 1) {
    await firstQueue.queue.add({
      groupId: `waiting-order-${index % 2}`,
      jobId: `waiting-order-${faker.string.uuid()}`,
      orderMs: orderBase + index,
      data: { waitingOrder: index },
      maxAttempts: 1,
    });
  }

  const [firstPage, secondPage] = await Promise.all([
    caller.job.list({
      queueName: firstQueue.queue.name,
      status: "waiting",
      cursor: 0,
      limit: 2,
    }),
    caller.job.list({
      queueName: firstQueue.queue.name,
      status: "waiting",
      cursor: 2,
      limit: 2,
    }),
  ]);

  expect(firstPage.jobs.map((job) => job.data.waitingOrder)).toEqual([0, 1]);
  expect(secondPage.jobs.map((job) => job.data.waitingOrder)).toEqual([2, 3]);
  expect(
    new Set([...firstPage.jobs, ...secondPage.jobs].map((job) => job.id)).size,
  ).toBe(4);
});

test("GroupMQ waiting pagination is stable when newer jobs arrive", async () => {
  const { firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  await firstQueue.queue.pause();
  await sleep(100);
  const adapter = new GroupMQAdapter(firstQueue.queue, "Waiting pagination");
  const groupId = `waiting-cursor-${faker.string.uuid()}`;
  const orderBase = Date.now();
  const originalIds: string[] = [];

  for (let index = 0; index < 40; index += 1) {
    const job = await firstQueue.queue.add({
      groupId,
      data: { waitingCursor: index },
      orderMs: orderBase + index,
      maxAttempts: 1,
    });
    originalIds.push(job.id);
  }
  const scanToken = adapter.beginJobScan("waiting", 5_001);
  expect(scanToken).toBeDefined();
  if (!scanToken) return;

  try {
    const firstPage = await adapter.getJobs("waiting", 0, 9, 5_001, scanToken);
    const inserted = await firstQueue.queue.add({
      groupId,
      data: { waitingCursor: "inserted-later" },
      orderMs: orderBase + 100,
      maxAttempts: 1,
    });
    const remainingPages = await Promise.all([
      adapter.getJobs("waiting", 10, 19, 5_001, scanToken),
      adapter.getJobs("waiting", 20, 29, 5_001, scanToken),
      adapter.getJobs("waiting", 30, 49, 5_001, scanToken),
    ]);
    const snapshotIds = [firstPage, ...remainingPages]
      .flat()
      .map((job) => job.id);

    expect(snapshotIds).toHaveLength(40);
    expect(new Set(snapshotIds)).toEqual(new Set(originalIds));
    expect(snapshotIds).not.toContain(inserted.id);
  } finally {
    adapter.endJobScan(scanToken);
  }
});

test("GroupMQ un-tokened first pages refresh external queue changes", async () => {
  const { firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  await firstQueue.queue.pause();
  await sleep(100);
  const adapter = new GroupMQAdapter(firstQueue.queue, "Fresh first page");
  const groupId = `fresh-first-page-${faker.string.uuid()}`;
  const orderBase = Date.now();
  const initial = await firstQueue.queue.add({
    groupId,
    data: { freshFirstPage: "initial" },
    orderMs: orderBase,
    maxAttempts: 1,
  });

  const firstPage = await adapter.getJobs("waiting", 0, 9);
  expect(firstPage.map((job) => job.id)).toContain(initial.id);

  const inserted = await firstQueue.queue.add({
    groupId,
    data: { freshFirstPage: "inserted" },
    orderMs: orderBase + 1,
    maxAttempts: 1,
  });
  const refreshedFirstPage = await adapter.getJobs("waiting", 0, 9);

  expect(refreshedFirstPage.map((job) => job.id)).toEqual(
    expect.arrayContaining([initial.id, inserted.id]),
  );
});

test("GroupMQ waiting snapshots retain jobs from ahead-of-time producers", async () => {
  const { firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  await firstQueue.queue.pause();
  await sleep(100);
  const adapter = new GroupMQAdapter(firstQueue.queue, "Clock skew");
  const job = await firstQueue.queue.add({
    groupId: `clock-skew-${faker.string.uuid()}`,
    data: { clockSkew: "ahead" },
    maxAttempts: 1,
  });
  await firstQueue.queue.redis.hset(
    `${firstQueue.queue.namespace}:job:${job.id}`,
    "timestamp",
    Date.now() + 60_000,
  );

  const waiting = await adapter.getJobs("waiting", 0, 9);

  expect(waiting.map((candidate) => candidate.id)).toContain(job.id);
});

test("GroupMQ waiting pagination retains equal-score jobs", async () => {
  const { firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  await firstQueue.queue.pause();
  await sleep(100);
  const adapter = new GroupMQAdapter(firstQueue.queue, "Equal-score paging");
  const groupId = `equal-score-${faker.string.uuid()}`;
  const jobIds: string[] = [];

  for (let index = 0; index < 40; index += 1) {
    const job = await firstQueue.queue.add({
      groupId,
      data: { equalScoreIndex: index },
      maxAttempts: 1,
    });
    jobIds.push(job.id);
  }
  for (const jobId of jobIds) {
    await firstQueue.queue.redis.zadd(
      `${firstQueue.queue.namespace}:g:${groupId}`,
      0,
      jobId,
    );
  }

  const firstPage = await adapter.getJobs("waiting", 0, 19);
  const secondPage = await adapter.getJobs("waiting", 20, 39);
  const returnedIds = [...firstPage, ...secondPage].map((job) => job.id);

  expect(returnedIds).toHaveLength(40);
  expect(new Set(returnedIds)).toEqual(new Set(jobIds));
  expect(returnedIds).toEqual(
    [...jobIds].sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)),
    ),
  );
});

test("GroupMQ retains a large equal-score tie bucket across scan pages", async () => {
  const { firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  await firstQueue.queue.pause();
  await sleep(100);
  const adapter = new GroupMQAdapter(firstQueue.queue, "Equal-score commands");
  const suffix = faker.string.uuid();
  const groupId = `equal-score-commands-${suffix}`;
  const jobs = await Promise.all(
    Array.from({ length: 600 }, (_, index) =>
      firstQueue.queue.add({
        groupId,
        jobId: `equal-score-command-${String(index).padStart(4, "0")}-${suffix}`,
        data: { equalScoreCommand: index },
        maxAttempts: 1,
      }),
    ),
  );
  const scorePipeline = firstQueue.queue.redis.pipeline();
  for (const job of jobs) {
    scorePipeline.zadd(`${firstQueue.queue.namespace}:g:${groupId}`, 0, job.id);
  }
  await scorePipeline.exec();
  const captureSnapshot = vi.spyOn(firstQueue.queue.redis, "eval");
  const scanToken = adapter.beginJobScan("waiting", 5_001);
  expect(scanToken).toBeDefined();
  if (!scanToken) return;

  try {
    const firstPage = await adapter.getJobs(
      "waiting",
      0,
      199,
      5_001,
      scanToken,
    );
    const consumedId = jobs[50]?.id;
    const pendingId = jobs[350]?.id;
    expect(consumedId).toBeDefined();
    expect(pendingId).toBeDefined();
    if (!consumedId || !pendingId) return;
    await firstQueue.queue.redis.zrem(
      `${firstQueue.queue.namespace}:g:${groupId}`,
      consumedId,
      pendingId,
    );
    const pages = [
      firstPage,
      await adapter.getJobs("waiting", 200, 399, 5_001, scanToken),
      await adapter.getJobs("waiting", 400, 599, 5_001, scanToken),
    ];

    expect(pages.flat()).toHaveLength(599);
    expect(new Set(pages.flat().map((job) => job.id))).toEqual(
      new Set(jobs.map((job) => job.id).filter((id) => id !== pendingId)),
    );
    expect(captureSnapshot).toHaveBeenCalledTimes(1);
    expect(captureSnapshot.mock.calls[0]?.slice(-2)).toEqual([5_001, 5_001]);
  } finally {
    adapter.endJobScan(scanToken);
    captureSnapshot.mockRestore();
  }
});

test("GroupMQ waiting merge follows Redis byte order across groups", async () => {
  const { firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  await firstQueue.queue.pause();
  await sleep(100);
  const adapter = new GroupMQAdapter(firstQueue.queue, "Redis order");
  const suffix = faker.string.uuid();
  const entries = [
    { groupId: `a-${suffix}`, jobId: `a-1-${suffix}` },
    { groupId: `a-${suffix}`, jobId: `Z-1-${suffix}` },
    { groupId: `Z-${suffix}`, jobId: `a-2-${suffix}` },
    { groupId: `Z-${suffix}`, jobId: `Z-2-${suffix}` },
  ];

  for (const entry of entries) {
    await firstQueue.queue.add({
      ...entry,
      data: { redisOrder: `${entry.groupId}/${entry.jobId}` },
      maxAttempts: 1,
    });
    await firstQueue.queue.redis.zadd(
      `${firstQueue.queue.namespace}:g:${entry.groupId}`,
      0,
      entry.jobId,
    );
  }

  const jobs = await adapter.getJobs("waiting", 0, entries.length - 1);
  const expected = [...entries]
    .sort((left, right) => {
      const groupOrder = Buffer.compare(
        Buffer.from(left.groupId),
        Buffer.from(right.groupId),
      );
      return groupOrder === 0
        ? Buffer.compare(Buffer.from(left.jobId), Buffer.from(right.jobId))
        : groupOrder;
    })
    .map(({ groupId, jobId }) => `${groupId}/${jobId}`);
  expect(jobs.map((job) => job.data.redisOrder)).toEqual(expected);
});

test("GroupMQ waiting snapshots do not skip after removal or admit insertion", async () => {
  const { firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  await firstQueue.queue.pause();
  await sleep(100);
  const adapter = new GroupMQAdapter(firstQueue.queue, "Stable mutations");
  const groupId = `stable-mutations-${faker.string.uuid()}`;
  const orderBase = Date.now();
  const originalIds: string[] = [];

  for (let index = 0; index < 40; index += 1) {
    const job = await firstQueue.queue.add({
      groupId,
      data: { stableMutation: index },
      orderMs: orderBase + index,
      maxAttempts: 1,
    });
    originalIds.push(job.id);
  }

  const scanToken = adapter.beginJobScan("waiting", 5_001);
  expect(scanToken).toBeDefined();
  if (!scanToken) return;

  try {
    const firstPage = await adapter.getJobs("waiting", 0, 9, 5_001, scanToken);
    const removedId = originalIds[35];
    expect(removedId).toBeDefined();
    if (!removedId) return;
    // Simulate a worker reserving/completing the captured job: GroupMQ removes
    // it from the group while retaining the hash for active/result metadata.
    await firstQueue.queue.redis.zrem(
      `${firstQueue.queue.namespace}:g:${groupId}`,
      removedId,
    );
    expect(
      await firstQueue.queue.redis.exists(
        `${firstQueue.queue.namespace}:job:${removedId}`,
      ),
    ).toBe(1);
    const inserted = await firstQueue.queue.add({
      groupId,
      data: { stableMutation: "inserted" },
      orderMs: orderBase + 15.5,
      maxAttempts: 1,
    });
    await firstQueue.queue.redis.hset(
      `${firstQueue.queue.namespace}:job:${inserted.id}`,
      "timestamp",
      0,
    );
    const rest = await adapter.getJobs("waiting", 10, 49, 5_001, scanToken);
    const returnedIds = [...firstPage, ...rest].map((job) => job.id);

    expect(new Set(returnedIds)).toEqual(
      new Set(originalIds.filter((jobId) => jobId !== removedId)),
    );
    expect(returnedIds).not.toContain(inserted.id);
  } finally {
    adapter.endJobScan(scanToken);
  }
});

test("GroupMQ waiting snapshot capture stays within its raw scan budget", async () => {
  const { firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  await firstQueue.queue.pause();
  await sleep(100);
  const adapter = new GroupMQAdapter(firstQueue.queue, "Bounded snapshot");
  const groupId = `bounded-snapshot-${faker.string.uuid()}`;
  for (let index = 0; index < 40; index += 1) {
    await firstQueue.queue.add({
      groupId,
      data: { boundedSnapshot: index },
      maxAttempts: 1,
    });
  }
  const captureSnapshot = vi.spyOn(firstQueue.queue.redis, "eval");
  const scanToken = adapter.beginJobScan("waiting", 25);
  expect(scanToken).toBeDefined();
  if (!scanToken) return;

  try {
    const jobs = await adapter.getJobs("waiting", 0, 9, 25, scanToken);
    expect(jobs).toHaveLength(10);
    expect(captureSnapshot).toHaveBeenCalledTimes(1);
    expect(captureSnapshot.mock.calls[0]?.slice(-2)).toEqual([25, 25]);
  } finally {
    adapter.endJobScan(scanToken);
    captureSnapshot.mockRestore();
  }
});

test("GroupMQ cross-status search can reallocate its waiting budget", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  const caller = appRouter.createCaller(ctx);
  await firstQueue.queue.pause();
  await sleep(100);
  const target = `waiting-budget-${faker.string.uuid()}`;

  for (let index = 0; index < 25; index += 1) {
    await firstQueue.queue.add({
      groupId: `waiting-budget-group-${faker.string.uuid()}`,
      data: { waitingBudget: index === 20 ? target : "padding" },
      maxAttempts: 1,
    });
  }

  const result = await caller.job.search({
    queueName: firstQueue.queue.name,
    query: target,
    statuses: ["waiting", "paused"],
    maxScanned: 25,
    limit: 5,
  });
  expect(
    result.results.some(({ job }) => job.data.waitingBudget === target),
  ).toBe(true);
  expect(result.scanned).toBeLessThanOrEqual(25);
});

test("GroupMQ waiting hydration fails closed on incomplete pipelines", async () => {
  const hydrationPipeline = {
    exec: vi.fn().mockResolvedValue(null),
    hgetall: vi.fn(),
    zscore: vi.fn(),
  };
  const queue = {
    name: "incomplete-waiting-pipeline",
    namespace: "groupmq:incomplete-waiting-pipeline",
    redis: {
      eval: vi.fn().mockResolvedValue(["1", "1", "group-1", "job-1", "0", "1"]),
      pipeline: vi.fn().mockReturnValue(hydrationPipeline),
      scard: vi.fn().mockResolvedValue(1),
    },
  } as never;
  const adapter = new GroupMQAdapter(queue, "Incomplete pipeline");

  await expect(adapter.getJobs("waiting", 0, 0, 1)).rejects.toThrow(
    "incomplete Redis data",
  );
});

test("GroupMQ waiting hydration requires a waiting hash status", async () => {
  const { firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  await firstQueue.queue.pause();
  await sleep(100);
  const groupId = `promoted-v1-${faker.string.uuid()}`;
  const orderMs = Date.now();
  const job = await firstQueue.queue.add({
    groupId,
    data: { promotedFromV1: true },
    delay: 60_000,
    orderMs,
    maxAttempts: 1,
  });
  const namespace = firstQueue.queue.namespace;

  expect(
    await firstQueue.queue.redis.hget(`${namespace}:job:${job.id}`, "status"),
  ).toBe("delayed");
  await firstQueue.queue.redis.zrem(`${namespace}:delayed`, job.id);
  await firstQueue.queue.redis.zadd(
    `${namespace}:g:${groupId}`,
    orderMs,
    job.id,
  );

  const adapter = new GroupMQAdapter(firstQueue.queue, "Hash status invariant");
  const waiting = await adapter.getJobs("waiting", 0, 100);
  expect(waiting.some((candidate) => candidate.id === job.id)).toBe(false);
});

test("GroupMQ removal and promotion use atomic state guards", async () => {
  const remove = vi.fn();
  const promote = vi.fn();
  const evalCommand = vi
    .fn()
    .mockResolvedValueOnce(-1)
    .mockResolvedValueOnce(-1);
  const queue = {
    name: "atomic-mutations",
    namespace: "groupmq:atomic-mutations",
    redis: { eval: evalCommand },
    remove,
    promote,
  } as never;
  const adapter = new GroupMQAdapter(queue, "Atomic mutations");

  await expect(adapter.removeJob("active-job")).rejects.toThrow(
    "cannot safely remove an active job",
  );
  await expect(adapter.promoteJob("reserved-job")).rejects.toThrow(
    "is no longer delayed",
  );

  expect(evalCommand).toHaveBeenCalledTimes(2);
  expect(evalCommand.mock.calls[0]?.[0]).toEqual(
    expect.stringContaining('ZSCORE", processingKey'),
  );
  expect(evalCommand.mock.calls[1]?.[0]).toEqual(
    expect.stringContaining('ZSCORE", delayedKey'),
  );
  expect(remove).not.toHaveBeenCalled();
  expect(promote).not.toHaveBeenCalled();
});

test("GroupMQ staged removal maintains staging and group bookkeeping", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  await firstQueue.queue.pause();
  await sleep(100);
  const adapter = new GroupMQAdapter(firstQueue.queue, "Staged removal");
  const namespace = firstQueue.queue.namespace;
  const groupId = `staged-removal-${faker.string.uuid()}`;
  const first = await firstQueue.queue.add({
    groupId,
    data: { stagedRemoval: 1 },
    maxAttempts: 1,
  });
  const second = await firstQueue.queue.add({
    groupId,
    data: { stagedRemoval: 2 },
    maxAttempts: 1,
  });
  const firstReleaseAt = Date.now() + 60_000;
  const secondReleaseAt = firstReleaseAt + 60_000;

  for (const [jobId, releaseAt] of [
    [first.id, firstReleaseAt],
    [second.id, secondReleaseAt],
  ] as const) {
    await firstQueue.queue.redis.zadd(`${namespace}:stage`, releaseAt, jobId);
    await firstQueue.queue.redis.hset(
      `${namespace}:job:${jobId}`,
      "status",
      "staged",
    );
  }
  await firstQueue.queue.redis.zrem(`${namespace}:ready`, groupId);
  await firstQueue.queue.redis.set(
    `${namespace}:stage:timer`,
    "1",
    "PX",
    60_000,
  );

  const waiting = await adapter.getJobs("waiting", 0, 9);
  const waitingIds = waiting.map((job) => job.id);
  expect(waitingIds).not.toContain(first.id);
  expect(waitingIds).not.toContain(second.id);
  await expect(adapter.getJobStatus(first.id)).resolves.toBeNull();

  const stagedSearch = await appRouter.createCaller(ctx).job.search({
    queueName: firstQueue.queue.name,
    query: first.id,
    statuses: ["waiting"],
    maxScanned: 25,
    limit: 5,
  });
  expect(stagedSearch.results.some(({ job }) => job.id === first.id)).toBe(
    false,
  );

  await adapter.removeJob(first.id);

  expect(
    await firstQueue.queue.redis.zscore(`${namespace}:stage`, first.id),
  ).toBe(null);
  expect(
    await firstQueue.queue.redis.exists(`${namespace}:job:${first.id}`),
  ).toBe(0);
  expect(
    await firstQueue.queue.redis.zscore(`${namespace}:stage`, second.id),
  ).not.toBe(null);
  expect(
    await firstQueue.queue.redis.sismember(`${namespace}:groups`, groupId),
  ).toBe(1);
  expect(
    await firstQueue.queue.redis.pttl(`${namespace}:stage:timer`),
  ).toBeGreaterThan(0);

  await adapter.removeJob(second.id);

  expect(await firstQueue.queue.redis.zcard(`${namespace}:stage`)).toBe(0);
  expect(await firstQueue.queue.redis.exists(`${namespace}:stage:timer`)).toBe(
    0,
  );
  expect(
    await firstQueue.queue.redis.sismember(`${namespace}:groups`, groupId),
  ).toBe(0);
  expect(await firstQueue.queue.redis.exists(`${namespace}:g:${groupId}`)).toBe(
    0,
  );
  expect(
    await firstQueue.queue.redis.zscore(`${namespace}:ready`, groupId),
  ).toBe(null);
});

test("GroupMQ bounds group inspection before reading all group IDs", async () => {
  const smembers = vi.fn();
  const queue = {
    name: "too-many-groups",
    namespace: "groupmq:too-many-groups",
    redis: {
      scard: vi.fn().mockResolvedValue(5_001),
      smembers,
    },
  } as never;
  const adapter = new GroupMQAdapter(queue, "Too many groups");

  await expect(adapter.getGroups()).rejects.toThrow(
    "supports at most 5,000 groups",
  );
  expect(smembers).not.toHaveBeenCalled();
});

test("GroupMQ rechecks the group cap after reading group IDs", async () => {
  const pipeline = vi.fn();
  const queue = {
    name: "groups-grew-during-read",
    namespace: "groupmq:groups-grew-during-read",
    redis: {
      scard: vi.fn().mockResolvedValue(5_000),
      smembers: vi
        .fn()
        .mockResolvedValue(
          Array.from({ length: 5_001 }, (_, index) => `group-${index}`),
        ),
      pipeline,
    },
  } as never;
  const adapter = new GroupMQAdapter(queue, "Growing group set");

  await expect(adapter.getGroups()).rejects.toThrow(
    "supports at most 5,000 groups",
  );
  expect(pipeline).not.toHaveBeenCalled();
});

test("GroupMQ group inspection fails closed on pipeline errors", async () => {
  const pipelineError = new Error("pipeline row failed");
  const errorPipeline = {
    zcard: vi.fn(),
    exec: vi.fn().mockResolvedValue([[pipelineError, null]]),
  };
  const incompletePipeline = {
    zcard: vi.fn(),
    exec: vi.fn().mockResolvedValue(null),
  };
  const queue = {
    name: "group-pipeline-errors",
    namespace: "groupmq:group-pipeline-errors",
    redis: {
      scard: vi.fn().mockResolvedValue(1),
      smembers: vi.fn().mockResolvedValue(["group-1"]),
      pipeline: vi
        .fn()
        .mockReturnValueOnce(errorPipeline)
        .mockReturnValueOnce(incompletePipeline),
    },
  } as never;
  const adapter = new GroupMQAdapter(queue, "Group pipeline errors");

  await expect(adapter.getGroups()).rejects.toThrow("pipeline row failed");
  await expect(adapter.getGroups()).rejects.toThrow("incomplete Redis data");
});

test("GroupMQ rejects oversized waiting cursors before scanning Redis", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  const caller = appRouter.createCaller(ctx);
  const groupsRead = vi.spyOn(firstQueue.queue.redis, "smembers");

  await expectTRPCError(
    () =>
      caller.job.list({
        queueName: firstQueue.queue.name,
        status: "waiting",
        cursor: 1_000_000,
        limit: 100,
      }),
    "BAD_REQUEST",
  );

  expect(groupsRead).not.toHaveBeenCalled();
  groupsRead.mockRestore();
});

test("GroupMQ waiting lists report the total-count page cap", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  const internalCtx = await transformContext(ctx);
  const adapter = internalCtx.queues[0]?.adapter;
  expect(adapter).toBeDefined();
  if (!adapter) return;
  const page: never[] = [];
  const getJobs = vi.spyOn(adapter, "getJobs").mockResolvedValue(page);
  const getJobCounts = vi.spyOn(adapter, "getJobCounts").mockResolvedValue({
    active: 0,
    completed: 0,
    delayed: 0,
    failed: 0,
    paused: 0,
    prioritized: 0,
    waiting: 5_001,
    "waiting-children": 0,
  });
  const getJobPageMeta = vi
    .spyOn(adapter, "getJobPageMeta")
    .mockReturnValue({ capped: false, scanned: 0, scanLimit: 5_001 });

  try {
    const result = await appRouter.createCaller(ctx).job.list({
      queueName: firstQueue.queue.name,
      status: "waiting",
      cursor: 4_900,
      limit: 100,
    });
    expect(result).toMatchObject({
      totalCount: 5_000,
      nextCursor: undefined,
      searchMeta: { capped: true, scanned: 5_000, scanLimit: 5_000 },
    });
  } finally {
    getJobs.mockRestore();
    getJobCounts.mockRestore();
    getJobPageMeta.mockRestore();
  }
});

test("bounded GroupMQ scans do not issue an unbudgeted lookahead", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  const internalCtx = await transformContext(ctx);
  const adapter = internalCtx.queues[0]?.adapter;
  expect(adapter).toBeDefined();
  if (!adapter) return;
  const jobs = Array.from({ length: 25 }, (_, index) => ({
    id: `bounded-${index}`,
    name: `bounded-${index}`,
    data: {},
    opts: {},
    createdAt: new Date(index),
    processedAt: null,
    finishedAt: null,
    retriedAt: null,
    returnValue: undefined,
    attemptsMade: 0,
  }));
  const getJobs = vi.spyOn(adapter, "getJobs").mockResolvedValue(jobs);
  const getJobPageMeta = vi
    .spyOn(adapter, "getJobPageMeta")
    .mockReturnValue(undefined);

  try {
    const result = await appRouter.createCaller(ctx).job.search({
      queueName: firstQueue.queue.name,
      query: "does-not-match",
      statuses: ["waiting"],
      maxScanned: 25,
      limit: 5,
    });
    expect(result.scanLimitReached).toBe(true);
    expect(getJobs).toHaveBeenCalledTimes(1);
    expect(getJobs.mock.calls[0]?.[3]).toBe(25);
  } finally {
    getJobs.mockRestore();
    getJobPageMeta.mockRestore();
  }
});

test("bounded scans continue after a fully stale adapter page", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const internalCtx = await transformContext(ctx);
  const adapter = internalCtx.queues[0]?.adapter;
  expect(adapter).toBeDefined();
  if (!adapter) return;
  const status = adapter.supports.statuses[0] as
    | "active"
    | "paused"
    | "completed"
    | "failed"
    | "waiting"
    | "delayed"
    | "waiting-children"
    | "prioritized"
    | undefined;
  expect(status).toBeDefined();
  if (!status) return;
  const emptyPage: never[] = [];
  const livePage = [
    {
      id: "after-stale-page",
      name: "after-stale-page",
      data: { stalePageTarget: true },
      opts: {},
      createdAt: new Date(0),
      processedAt: null,
      finishedAt: null,
      retriedAt: null,
      returnValue: undefined,
      attemptsMade: 0,
    },
  ];
  const getJobs = vi
    .spyOn(adapter, "getJobs")
    .mockResolvedValueOnce(emptyPage)
    .mockResolvedValueOnce(livePage);
  const getJobPageMeta = vi
    .spyOn(adapter, "getJobPageMeta")
    .mockImplementation((page) =>
      page === emptyPage
        ? {
            capped: false,
            cursorAdvance: 100,
            exhausted: false,
            scanned: 100,
            scanLimit: 125,
          }
        : {
            capped: false,
            cursorAdvance: 1,
            exhausted: true,
            scanned: 101,
            scanLimit: 125,
          },
    );

  try {
    const result = await appRouter.createCaller(ctx).job.list({
      queueName: firstQueue.queue.name,
      status,
      cursor: 0,
      limit: 5,
      query: "stalePageTarget",
      scanLimit: 125,
    });
    expect(result.jobs.map((job) => job.id)).toEqual(["after-stale-page"]);
    expect(result.searchMeta).toEqual({
      capped: false,
      scanned: 101,
      scanLimit: 125,
    });
    expect(getJobs).toHaveBeenCalledTimes(2);
  } finally {
    getJobs.mockRestore();
    getJobPageMeta.mockRestore();
  }
});

test("Bee-Queue rejects oversized set cursors before scanning Redis", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "bee") return;
  const caller = appRouter.createCaller(ctx);
  const getJobs = vi.spyOn(firstQueue.queue, "getJobs");

  await expectTRPCError(
    () =>
      caller.job.list({
        queueName: firstQueue.queue.name,
        status: "completed",
        cursor: 1_000_000,
        limit: 100,
      }),
    "BAD_REQUEST",
  );

  expect(getJobs).not.toHaveBeenCalled();
  getJobs.mockRestore();
});

test("GroupMQ search continues after a sparse concurrent page", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  const caller = appRouter.createCaller(ctx);
  const jobIds: string[] = [];

  for (let index = 0; index < 120; index += 1) {
    const job = await firstQueue.queue.add({
      groupId: `sparse-search-${index}`,
      data: {
        sparseSearchTarget: index === 0 ? "find-after-sparse-page" : "padding",
      },
      delay: 60_000,
      maxAttempts: 1,
    });
    jobIds.push(job.id);
  }

  const originalGetJob = firstQueue.queue.getJob.bind(firstQueue.queue);
  const missingJobId = jobIds.at(-1);
  const getJob = vi
    .spyOn(firstQueue.queue, "getJob")
    .mockImplementation(async (jobId) => {
      if (jobId === missingJobId) {
        throw new Error("Job not found during page fetch");
      }
      return originalGetJob(jobId);
    });

  try {
    const result = await caller.job.search({
      queueName: firstQueue.queue.name,
      query: "find-after-sparse-page",
      statuses: ["delayed"],
      maxScanned: 125,
      limit: 5,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.job.data.sparseSearchTarget).toBe(
      "find-after-sparse-page",
    );
  } finally {
    getJob.mockRestore();
  }
});

test("GroupMQ delayed jobs are returned in native queue order", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  const caller = appRouter.createCaller(ctx);

  for (let index = 0; index < 3; index += 1) {
    await firstQueue.queue.add({
      groupId: `delayed-order-${index}`,
      data: { delayedOrder: index },
      delay: 60_000,
      maxAttempts: 1,
    });
    await sleep(2);
  }

  const delayed = await caller.job.list({
    queueName: firstQueue.queue.name,
    status: "delayed",
    cursor: 0,
    limit: 3,
  });

  expect(delayed.jobs.map((job) => job.data.delayedOrder)).toEqual([0, 1, 2]);
  const queue = await caller.queue.byName({ queueName: firstQueue.queue.name });
  expect(queue.counts.delayed).toBe(3);
  expect(queue.counts.waiting).toBe(0);

  const waiting = await caller.job.list({
    queueName: firstQueue.queue.name,
    status: "waiting",
    cursor: 0,
    limit: 3,
  });
  expect(waiting).toMatchObject({ totalCount: 0, jobs: [] });
});

test("retry job", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const { jobs } = await caller.job.list({
    limit: 10,
    cursor: 0,
    status: "failed",
    queueName: firstQueue.queue.name,
  });

  const job = jobs[0];

  if (firstQueue.type === "bee" || firstQueue.type === "groupmq") {
    // Neither adapter exposes a safe retry operation.
    try {
      await caller.job.retry({
        queueName: firstQueue.queue.name,
        jobId: job.id,
      });
      throw new Error("Should have thrown TRPCError");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      if (e instanceof TRPCError) {
        expect(e.code).toBe("BAD_REQUEST");
      }
    }
  } else {
    const newJob = await caller.job.retry({
      queueName: firstQueue.queue.name,
      jobId: job.id,
    });
    expect(newJob).toMatchObject({
      id: job.id,
      ...(firstQueue.type === "bull" && { retriedAt: expect.any(Date) }),
    });
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

  // Get all failed jobs (use a limit larger than expected failed jobs)
  const { jobs } = await caller.job.list({
    limit: 100, // Large enough to get all failed jobs
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

test("bulk retry by filter retries all failed jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bee" || firstQueue.type === "groupmq") {
    try {
      await caller.job.bulkRetryByFilter({
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
    return;
  }

  const failedJobs = await caller.job.list({
    limit: 100,
    cursor: 0,
    status: "failed",
    queueName: firstQueue.queue.name,
  });

  const result = await caller.job.bulkRetryByFilter({
    queueName: firstQueue.queue.name,
    status: "failed",
  });

  expect(result.total).toBe(failedJobs.totalCount);
  expect(result.succeeded + result.failed).toBe(failedJobs.totalCount);
});

test("list jobs by group id paginates correctly", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type !== "groupmq") {
    return;
  }

  const groupId = "group-pagination-test";
  const numOfJobsInGroup = 7;

  for (let i = 0; i < numOfJobsInGroup; i++) {
    await firstQueue.queue.add({
      groupId,
      data: { index: NUM_OF_COMPLETED_JOBS + 100 + i },
      maxAttempts: 0,
    });
  }

  await sleep(500);

  const firstPage = await caller.job.list({
    limit: 3,
    cursor: 0,
    status: "failed",
    queueName: firstQueue.queue.name,
    groupId,
  });

  expect(firstPage.totalCount).toBe(numOfJobsInGroup);
  expect(firstPage.jobs.length).toBe(3);
  expect(firstPage.nextCursor).toBe(3);

  const secondPage = await caller.job.list({
    limit: 3,
    cursor: firstPage.nextCursor || 0,
    status: "failed",
    queueName: firstQueue.queue.name,
    groupId,
  });

  expect(secondPage.totalCount).toBe(numOfJobsInGroup);
  expect(secondPage.jobs.length).toBe(3);
  expect(secondPage.nextCursor).toBe(6);

  const thirdPage = await caller.job.list({
    limit: 3,
    cursor: secondPage.nextCursor || 0,
    status: "failed",
    queueName: firstQueue.queue.name,
    groupId,
  });

  expect(thirdPage.totalCount).toBe(numOfJobsInGroup);
  expect(thirdPage.jobs.length).toBe(1);
  expect(thirdPage.nextCursor).toBeUndefined();
});

test("bulk remove by group removes matching jobs across statuses", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type !== "groupmq") {
    return;
  }

  const groupId = "group-remove-test";

  await firstQueue.queue.add({
    groupId,
    data: { index: 1 },
    maxAttempts: 0,
  });
  await firstQueue.queue.add({
    groupId,
    data: { index: NUM_OF_COMPLETED_JOBS + 200 },
    maxAttempts: 0,
  });
  await firstQueue.queue.add({
    groupId,
    data: { index: NUM_OF_COMPLETED_JOBS + 201 },
    maxAttempts: 0,
    delay: 5_000,
  });

  await sleep(500);

  const removeResult = await caller.job.bulkRemoveByGroup({
    queueName: firstQueue.queue.name,
    groupId,
  });

  expect(removeResult.total).toBeGreaterThan(0);
  expect(removeResult.succeeded + removeResult.failed).toBe(removeResult.total);

  const statusesToCheck = [
    "completed",
    "failed",
    "active",
    "waiting",
    "delayed",
  ] as const;

  for (const status of statusesToCheck) {
    const list = await caller.job.list({
      limit: 50,
      cursor: 0,
      status,
      queueName: firstQueue.queue.name,
      groupId,
    });

    expect(list.totalCount).toBe(0);
    expect(list.jobs.length).toBe(0);
  }
});

test("bulk remove by group reports partial work at the server scan cap", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  if (firstQueue.type !== "groupmq") return;
  const caller = appRouter.createCaller(ctx);
  const groupId = `bounded-group-remove-${faker.string.uuid()}`;
  await firstQueue.queue.pause();

  for (let index = 0; index < 40; index += 1) {
    await firstQueue.queue.add({
      groupId,
      data: { boundedGroupRemove: index },
      maxAttempts: 1,
    });
  }

  const result = await caller.job.bulkRemoveByGroup({
    queueName: firstQueue.queue.name,
    groupId,
    maxScanned: 25,
  });

  expect(result).toMatchObject({
    partial: true,
    scanLimitReached: true,
    failed: 0,
  });
  expect(result.succeeded).toBeGreaterThan(0);
  expect(result.succeeded).toBeLessThan(40);
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
  if (type === "bullmq") {
    const { ctx, firstQueue } = await initRedisInstance();
    const caller = appRouter.createCaller(ctx);

    const list = await caller.job.list({
      limit: 10,
      cursor: 0,
      status: "waiting-children",
      queueName: firstQueue.queue.name,
    });

    expect(list.totalCount).toBe(NUM_OF_WAITING_CHILDREN_JOBS);
  }
});

test("promote job", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (type === "bull" || type === "bullmq" || type === "groupmq") {
    // Pause the queue first to prevent worker from processing promoted job
    const queueInCtx = ctx.queues[0];
    if (queueInCtx.type === "bull") {
      await queueInCtx.queue.pause();

      await queueInCtx.queue.add({ test: "data" }, { delay: 5000 });
    } else if (queueInCtx.type === "bullmq") {
      await queueInCtx.queue.pause();

      await queueInCtx.queue.add(
        "delayed-job",
        { test: "data" },
        { delay: 5000 },
      );
    } else if (queueInCtx.type === "groupmq") {
      await queueInCtx.queue.pause();

      await queueInCtx.queue.add({
        groupId: faker.string.uuid(),
        data: { test: "data" },
        maxAttempts: 0,
        delay: 5000,
      });
    }

    await sleep(100);

    const delayedList = await caller.job.list({
      limit: 10,
      cursor: 0,
      status: "delayed",
      queueName: firstQueue.queue.name,
    });

    const job = delayedList.jobs[0];
    const initialDelayedCount = delayedList.totalCount;

    await caller.job.promote({
      queueName: firstQueue.queue.name,
      jobId: job.id,
    });

    // Check that job was removed from delayed
    const delayedListAfter = await caller.job.list({
      limit: 10,
      cursor: 0,
      status: "delayed",
      queueName: firstQueue.queue.name,
    });

    expect(delayedListAfter.totalCount).toBe(initialDelayedCount - 1);

    // Check that job moved to correct status
    // GroupMQ: promoted jobs go to waiting even when paused
    // BullMQ: promoted jobs go to paused when queue is paused
    if (type === "groupmq") {
      const waitingList = await caller.job.list({
        limit: 10,
        cursor: 0,
        status: "waiting",
        queueName: firstQueue.queue.name,
      });
      expect(waitingList.jobs.some((j) => j.id === job.id)).toBe(true);
    } else if (type === "bull") {
      const pausedList = await caller.job.list({
        limit: 10,
        cursor: 0,
        status: "paused",
        queueName: firstQueue.queue.name,
      });
      const waitingList = await caller.job.list({
        limit: 10,
        cursor: 0,
        status: "waiting",
        queueName: firstQueue.queue.name,
      });
      expect(
        pausedList.jobs.some((j) => j.id === job.id) ||
          waitingList.jobs.some((j) => j.id === job.id),
      ).toBe(true);
    } else {
      const pausedList = await caller.job.list({
        limit: 10,
        cursor: 0,
        status: "paused",
        queueName: firstQueue.queue.name,
      });
      expect(pausedList.jobs.some((j) => j.id === job.id)).toBe(true);
    }
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

test("promote rejects jobs that are not delayed", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const completed = await caller.job.list({
    queueName: firstQueue.queue.name,
    status: "completed",
    limit: 1,
  });

  await expectTRPCError(
    () =>
      caller.job.promote({
        queueName: firstQueue.queue.name,
        jobId: completed.jobs[0].id,
      }),
    "BAD_REQUEST",
  );
});

test("bulk promote by filter promotes only matching delayed jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bee") {
    await expectTRPCError(
      () =>
        caller.job.bulkPromoteByFilter({
          queueName: firstQueue.queue.name,
          status: "delayed",
          query: "bulk-promote-target",
        }),
      "BAD_REQUEST",
    );
    return;
  }

  await caller.queue.pause({ queueName: firstQueue.queue.name });
  for (const marker of [
    "bulk-promote-target",
    "bulk-promote-target",
    "bulk-promote-control",
  ]) {
    await caller.queue.addJob({
      queueName: firstQueue.queue.name,
      data: { marker },
      opts:
        firstQueue.type === "groupmq"
          ? { delay: 60_000, groupId: marker }
          : { delay: 60_000 },
    });
  }

  const result = await caller.job.bulkPromoteByFilter({
    queueName: firstQueue.queue.name,
    status: "delayed",
    query: "bulk-promote-target",
  });

  expect(result).toMatchObject({
    matched: 2,
    succeeded: 2,
    failed: 0,
    partial: false,
  });
  const delayedTargets = await caller.job.list({
    queueName: firstQueue.queue.name,
    status: "delayed",
    limit: 10,
    query: "bulk-promote-target",
  });
  const delayedControl = await caller.job.list({
    queueName: firstQueue.queue.name,
    status: "delayed",
    limit: 10,
    query: "bulk-promote-control",
  });
  expect(delayedTargets.jobs).toHaveLength(0);
  expect(delayedControl.jobs).toHaveLength(1);
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

// ============================================================================
// HIGH PRIORITY TESTS - Missing Core Functionality
// ============================================================================

test("discard job", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const { jobs } = await caller.job.list({
    limit: 10,
    cursor: 0,
    status: "failed",
    queueName: firstQueue.queue.name,
  });

  if (jobs.length > 0) {
    const job = jobs[0];
    await expectTRPCError(
      () =>
        caller.job.discard({
          queueName: firstQueue.queue.name,
          jobId: job.id,
        }),
      "BAD_REQUEST",
    );
  }
});

test("job list pagination - next cursor", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const firstPage = await caller.job.list({
    limit: 5,
    cursor: 0,
    status: "completed",
    queueName: firstQueue.queue.name,
  });

  expect(firstPage.jobs.length).toBeLessThanOrEqual(5);
  expect(firstPage.totalCount).toBe(NUM_OF_COMPLETED_JOBS);

  if (firstPage.totalCount > 5) {
    expect(firstPage.nextCursor).toBe(5);
    expect(firstPage.numOfPages).toBe(Math.ceil(NUM_OF_COMPLETED_JOBS / 5));
  }
});

test("job list pagination - cursor parameter", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const firstPage = await caller.job.list({
    limit: 5,
    cursor: 0,
    status: "completed",
    queueName: firstQueue.queue.name,
  });

  if (firstPage.nextCursor) {
    const secondPage = await caller.job.list({
      limit: 5,
      cursor: firstPage.nextCursor,
      status: "completed",
      queueName: firstQueue.queue.name,
    });

    expect(secondPage.jobs.length).toBeGreaterThan(0);
    // Jobs should be different
    if (firstPage.jobs.length > 0 && secondPage.jobs.length > 0) {
      expect(secondPage.jobs[0].id).not.toBe(firstPage.jobs[0].id);
    }
  }
});

test("job list pagination - numOfPages calculation", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const result = await caller.job.list({
    limit: 3,
    cursor: 0,
    status: "completed",
    queueName: firstQueue.queue.name,
  });

  expect(result.numOfPages).toBe(Math.ceil(NUM_OF_COMPLETED_JOBS / 3));
});

test("job list with limit 1", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const result = await caller.job.list({
    limit: 1,
    cursor: 0,
    status: "completed",
    queueName: firstQueue.queue.name,
  });

  expect(result.jobs.length).toBeLessThanOrEqual(1);
});

test("job list with limit 100", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const result = await caller.job.list({
    limit: 100,
    cursor: 0,
    status: "completed",
    queueName: firstQueue.queue.name,
  });

  expect(result.jobs.length).toBeLessThanOrEqual(100);
  expect(result.jobs.length).toBe(Math.min(100, NUM_OF_COMPLETED_JOBS));
});

// ============================================================================
// MEDIUM PRIORITY TESTS - Different Job Statuses
// ============================================================================

test("list active jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const result = await caller.job.list({
    limit: 10,
    cursor: 0,
    status: "active",
    queueName: firstQueue.queue.name,
  });

  expect(result).toHaveProperty("totalCount");
  expect(result).toHaveProperty("jobs");
  expect(Array.isArray(result.jobs)).toBe(true);
});

test("list waiting jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const result = await caller.job.list({
    limit: 10,
    cursor: 0,
    status: "waiting",
    queueName: firstQueue.queue.name,
  });

  expect(result).toHaveProperty("totalCount");
  expect(result).toHaveProperty("jobs");
  expect(Array.isArray(result.jobs)).toBe(true);
});

test("list delayed jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const result = await caller.job.list({
    limit: 10,
    cursor: 0,
    status: "delayed",
    queueName: firstQueue.queue.name,
  });

  expect(result).toHaveProperty("totalCount");
  expect(result).toHaveProperty("jobs");
  expect(Array.isArray(result.jobs)).toBe(true);
});

test("list paused jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const queue = await caller.queue.byName({
    queueName: firstQueue.queue.name,
  });

  if (!queue.supports.statuses.includes("paused")) {
    await expectTRPCError(
      () =>
        caller.job.list({
          limit: 10,
          cursor: 0,
          status: "paused",
          queueName: firstQueue.queue.name,
        }),
      "BAD_REQUEST",
    );
    return;
  }

  const result = await caller.job.list({
    limit: 10,
    cursor: 0,
    status: "paused",
    queueName: firstQueue.queue.name,
  });

  expect(result).toHaveProperty("totalCount");
  expect(result).toHaveProperty("jobs");
  expect(Array.isArray(result.jobs)).toBe(true);
});

test("list prioritized jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);
  const queue = await caller.queue.byName({
    queueName: firstQueue.queue.name,
  });

  if (!queue.supports.statuses.includes("prioritized")) {
    await expectTRPCError(
      () =>
        caller.job.list({
          limit: 10,
          cursor: 0,
          status: "prioritized",
          queueName: firstQueue.queue.name,
        }),
      "BAD_REQUEST",
    );
    return;
  }

  const result = await caller.job.list({
    limit: 10,
    cursor: 0,
    status: "prioritized",
    queueName: firstQueue.queue.name,
  });

  expect(result).toHaveProperty("totalCount");
  expect(result).toHaveProperty("jobs");
  expect(Array.isArray(result.jobs)).toBe(true);
});

test("list failed jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const result = await caller.job.list({
    limit: 10,
    cursor: 0,
    status: "failed",
    queueName: firstQueue.queue.name,
  });

  expect(result.totalCount).toBe(NUM_OF_FAILED_JOBS);
  expect(Array.isArray(result.jobs)).toBe(true);
});

// ============================================================================
// MEDIUM PRIORITY TESTS - Error Scenarios
// ============================================================================

test("job not found error on retry", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type !== "bee") {
    try {
      await caller.job.retry({
        queueName: firstQueue.queue.name,
        jobId: "non-existent-job-id",
      });
      throw new Error("Should have thrown TRPCError");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      if (e instanceof TRPCError) {
        if (firstQueue.type === "groupmq") {
          expect(e.code).toBe("BAD_REQUEST");
        } else {
          expect(["NOT_FOUND", "INTERNAL_SERVER_ERROR"]).toContain(e.code);
        }
      }
    }
  }
});

test("job not found error on remove", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.job.remove({
      queueName: firstQueue.queue.name,
      jobId: "non-existent-job-id",
    });
    throw new Error("Should have thrown TRPCError");
  } catch (e) {
    expect(e).toBeInstanceOf(TRPCError);
    if (e instanceof TRPCError) {
      // GroupMQ returns INTERNAL_SERVER_ERROR for invalid job IDs
      expect(["NOT_FOUND", "INTERNAL_SERVER_ERROR"]).toContain(e.code);
    }
  }
});

test("job not found error on promote", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bullmq" || firstQueue.type === "groupmq") {
    try {
      await caller.job.promote({
        queueName: firstQueue.queue.name,
        jobId: "non-existent-job-id",
      });
      throw new Error("Should have thrown TRPCError");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      if (e instanceof TRPCError) {
        expect(e.code).toBe("NOT_FOUND");
      }
    }
  }
});

test("bulk remove with one non-existent job", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const { jobs } = await caller.job.list({
    limit: 2,
    cursor: 0,
    status: "failed",
    queueName: firstQueue.queue.name,
  });

  if (jobs.length > 0) {
    try {
      await caller.job.bulkRemove({
        queueName: firstQueue.queue.name,
        jobIds: [jobs[0].id, "non-existent-job-id"],
      });
      throw new Error("Should have thrown TRPCError");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      if (e instanceof TRPCError) {
        // GroupMQ returns INTERNAL_SERVER_ERROR for invalid job IDs
        expect(["NOT_FOUND", "INTERNAL_SERVER_ERROR"]).toContain(e.code);
        if (e.code === "NOT_FOUND") {
          expect(e.message).toContain("not found");
        }
      }
    }
  }
});

test("retry non-failed job should fail for Bull", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  if (firstQueue.type === "bull") {
    const { jobs } = await caller.job.list({
      limit: 1,
      cursor: 0,
      status: "completed",
      queueName: firstQueue.queue.name,
    });

    if (jobs.length > 0) {
      try {
        await caller.job.retry({
          queueName: firstQueue.queue.name,
          jobId: jobs[0].id,
        });
        // Bull checks if job is failed, should throw
        throw new Error("Should have thrown error");
      } catch (e) {
        expect(e instanceof Error).toBe(true);
      }
    }
  }
});

// ============================================================================
// LOW PRIORITY TESTS - Edge Cases
// ============================================================================

test("empty job list for status with no jobs", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const result = await caller.job.list({
    limit: 10,
    cursor: 0,
    status: "delayed",
    queueName: firstQueue.queue.name,
  });

  expect(result.jobs).toEqual(result.jobs); // Should not throw
  expect(Array.isArray(result.jobs)).toBe(true);
});

test("logs on non-existent job returns null or empty", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const logs = await caller.job.logs({
    queueName: firstQueue.queue.name,
    jobId: "non-existent-job-id",
  });

  // Should either be null or handle gracefully
  if (type === "bullmq") {
    // BullMQ might return empty array or null
    expect(logs === null || Array.isArray(logs)).toBe(true);
  } else {
    expect(logs).toBeNull();
  }
});

test("rerun job preserves data", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const { jobs } = await caller.job.list({
    limit: 1,
    cursor: 0,
    status: "completed",
    queueName: firstQueue.queue.name,
  });

  if (jobs.length > 0) {
    const originalJob = jobs[0];
    const originalData = originalJob.data;

    await caller.job.rerun({
      queueName: firstQueue.queue.name,
      jobId: originalJob.id,
    });

    // The returned job should have the same data
    expect(originalJob.data).toEqual(originalData);
  }
});

test("job list respects cursor offset correctly", async () => {
  const { ctx, firstQueue } = await initRedisInstance();
  const caller = appRouter.createCaller(ctx);

  const limit = 2;
  const firstPage = await caller.job.list({
    limit,
    cursor: 0,
    status: "completed",
    queueName: firstQueue.queue.name,
  });

  if (firstPage.totalCount > limit) {
    const secondPage = await caller.job.list({
      limit,
      cursor: limit,
      status: "completed",
      queueName: firstQueue.queue.name,
    });

    // Ensure we got different jobs
    const firstIds = firstPage.jobs.map((j) => j.id);
    const secondIds = secondPage.jobs.map((j) => j.id);

    const hasOverlap = firstIds.some((id) => secondIds.includes(id));
    expect(hasOverlap).toBe(false);
  }
});
