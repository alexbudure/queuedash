import { randomBytes } from "node:crypto";

import { Queue as GroupMQQueue, Worker as GroupMQWorker } from "groupmq";
import Redis from "ioredis";
import { afterEach, expect, test, vi } from "vitest";

import { JobNotFoundError } from "../queue-adapters/base.adapter";
import { GroupMQAdapter } from "../queue-adapters/groupmq.adapter";
import { appRouter } from "../routers/_app";
import { type } from "./test.utils";

const MAX_GROUPS = 5_000;

const groupIds = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, index) => `group-${from + index}`);

const zcardPipeline = () => {
  const pipeline = {
    zcard: vi.fn(),
    exec: vi.fn(async () =>
      pipeline.zcard.mock.calls.map(() => [null, 1] as const),
    ),
  };
  return pipeline;
};

test("GroupMQ scans a bounded slice of an oversized group set", async () => {
  const smembers = vi.fn();
  const pipeline = zcardPipeline();
  const sscan = vi
    .fn()
    .mockResolvedValueOnce(["17", groupIds(0, 3_000)])
    .mockResolvedValueOnce(["0", groupIds(3_000, 5_001)]);
  const queue = {
    name: "too-many-groups",
    namespace: "groupmq:too-many-groups",
    redis: {
      scard: vi.fn().mockResolvedValue(5_001),
      smembers,
      sscan,
      pipeline: vi.fn().mockReturnValue(pipeline),
    },
  } as never;
  const adapter = new GroupMQAdapter(queue, "Too many groups");

  const groups = await adapter.getGroups();

  expect(groups).toHaveLength(MAX_GROUPS);
  expect(smembers).not.toHaveBeenCalled();
  expect(sscan.mock.calls.map((call) => call[1])).toEqual(["0", "17"]);
  expect(pipeline.zcard).toHaveBeenCalledTimes(MAX_GROUPS);
});

test("GroupMQ trims a group set that grew while it was read", async () => {
  const pipeline = zcardPipeline();
  const queue = {
    name: "groups-grew-during-read",
    namespace: "groupmq:groups-grew-during-read",
    redis: {
      scard: vi.fn().mockResolvedValue(MAX_GROUPS),
      smembers: vi.fn().mockResolvedValue(groupIds(0, 5_001)),
      pipeline: vi.fn().mockReturnValue(pipeline),
    },
  } as never;
  const adapter = new GroupMQAdapter(queue, "Growing group set");

  await expect(adapter.getGroups()).resolves.toHaveLength(MAX_GROUPS);
  expect(pipeline.zcard).toHaveBeenCalledTimes(MAX_GROUPS);
});

// The rest run against real GroupMQ queues, only in the GroupMQ suite. Each
// queue lives under a unique namespace whose keys are deleted afterwards.
const namespaces: string[] = [];
const queues: GroupMQQueue[] = [];

const createQueue = (
  options: Partial<ConstructorParameters<typeof GroupMQQueue>[0]> = {},
) => {
  const namespace = `qd-groupmq-adapter-${randomBytes(4).toString("hex")}`;
  const queue = new GroupMQQueue({ redis: new Redis(), namespace, ...options });
  namespaces.push(namespace);
  queues.push(queue);
  return queue;
};

const addJobs = async (
  queue: GroupMQQueue,
  count: number,
  jobAt: (index: number) => Parameters<GroupMQQueue["add"]>[0],
) => {
  for (let start = 0; start < count; start += 500) {
    await Promise.all(
      Array.from({ length: Math.min(500, count - start) }, (_, offset) =>
        queue.add(jobAt(start + offset)),
      ),
    );
  }
};

afterEach(async () => {
  // GroupMQ's close() quits the client it was handed, so cleanup brings its own.
  await Promise.allSettled(queues.splice(0).map((queue) => queue.close()));
  const redis = new Redis();
  try {
    for (const namespace of namespaces.splice(0)) {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          "MATCH",
          `groupmq:${namespace}:*`,
          "COUNT",
          1_000,
        );
        cursor = nextCursor;
        if (keys.length > 0) await redis.unlink(...keys);
      } while (cursor !== "0");
    }
  } finally {
    redis.disconnect();
  }
}, 20_000);

test.runIf(type === "groupmq")(
  "GroupMQ implements the adapter contract",
  async () => {
    const queue = createQueue({ keepCompleted: 10, keepFailed: 10 });
    const adapter = new GroupMQAdapter(queue, "Contract");
    expect(adapter.supports.addJobOptionKeys).toEqual([
      "delay",
      "groupId",
      "jobId",
      "maxAttempts",
      "orderMs",
      "runAt",
    ]);
    await expect(adapter.getWorkers()).resolves.toBeNull();
    await expect(adapter.removeJob("missing-job")).rejects.toBeInstanceOf(
      JobNotFoundError,
    );
    await expect(adapter.promoteJob("missing-job")).rejects.toBeInstanceOf(
      JobNotFoundError,
    );

    const worker = new GroupMQWorker({
      queue,
      maxAttempts: 1,
      handler: async (job) => {
        if ((job.data as { fail: boolean }).fail) {
          throw new Error("contract failure");
        }
      },
    });
    try {
      for (const fail of [true, false, true]) {
        await queue.add({
          groupId: `contract-${randomBytes(4).toString("hex")}`,
          data: { fail },
          maxAttempts: 1,
        });
      }
      await vi.waitFor(
        async () => {
          expect(await queue.getFailedCount()).toBe(2);
          expect(await queue.getCompletedCount()).toBe(1);
        },
        { interval: 50, timeout: 8_000 },
      );
    } finally {
      await worker.close(0);
    }

    const getJobCounts = vi.spyOn(queue, "getJobCounts");
    try {
      await expect(adapter.getFailedCount()).resolves.toBe(2);
      expect(getJobCounts).not.toHaveBeenCalled();
    } finally {
      getJobCounts.mockRestore();
    }
    await expect(adapter.getJobCounts()).resolves.toMatchObject({ failed: 2 });
  },
  15_000,
);

test.runIf(type === "groupmq")(
  "GroupMQ lists the first 5,000 groups and flags the cut instead of throwing",
  async () => {
    const queue = createQueue();
    const groupCount = MAX_GROUPS + 1;
    // Every third group holds only a delayed job, so the waiting total stays
    // under the router's own 5,000-job cap and the page meta alone has to tell
    // the list it is incomplete.
    for (let start = 0; start < groupCount; start += 500) {
      await Promise.all(
        Array.from(
          { length: Math.min(500, groupCount - start) },
          (_, offset) => {
            const index = start + offset;
            return queue.add({
              groupId: `tenant-${index}`,
              data: { index },
              ...(index % 3 === 0 ? { delay: 60_000 } : {}),
              maxAttempts: 1,
            });
          },
        ),
      );
    }
    const adapter = new GroupMQAdapter(queue, "Many groups");

    const firstPage = await adapter.getJobs("waiting", 0, 29);
    expect(firstPage).toHaveLength(30);
    expect(adapter.getJobPageMeta(firstPage)).toMatchObject({
      capped: true,
      exhausted: false,
      truncated: true,
    });

    const scanToken = adapter.beginJobScan("waiting", MAX_GROUPS + 1);
    expect(scanToken).toBeDefined();
    if (!scanToken) return;
    const scannedGroups = new Set<string>();
    const pageMetas = [];
    try {
      for (let start = 0; start <= MAX_GROUPS; start += 1_000) {
        const page = await adapter.getJobs(
          "waiting",
          start,
          start + 999,
          MAX_GROUPS + 1,
          scanToken,
        );
        for (const job of page) scannedGroups.add(job.groupId ?? "");
        const meta = adapter.getJobPageMeta(page);
        pageMetas.push(meta);
        if (meta?.capped || meta?.exhausted) break;
      }
    } finally {
      adapter.endJobScan(scanToken);
    }
    // A bounded scan runs to the end of what it can see before it says so,
    // because a scan stops reading a status at its first truncated page.
    expect(pageMetas.slice(0, -1)).not.toContainEqual(
      expect.objectContaining({ capped: true }),
    );
    expect(pageMetas.at(-1)).toMatchObject({
      capped: true,
      exhausted: false,
      truncated: true,
    });

    const groups = await adapter.getGroups();
    expect(groups).toHaveLength(MAX_GROUPS);
    const listedGroups = new Set(groups.map((group) => group.id));
    // The waiting list and the Groups panel inspect the same slice of groups.
    expect([...scannedGroups].every((id) => listedGroups.has(id))).toBe(true);
    const waitingGroups = [...listedGroups].filter(
      (id) => Number(id.slice("tenant-".length)) % 3 !== 0,
    );
    expect(scannedGroups.size).toBe(waitingGroups.length);

    const caller = appRouter.createCaller({
      queues: [{ queue, displayName: "Many groups", type: "groupmq" }],
    });
    const queueName = queue.name;
    const list = await caller.job.list({
      queueName,
      status: "waiting",
      limit: 30,
    });
    expect(list.jobs).toHaveLength(30);
    expect(list.searchMeta).toMatchObject({ capped: true });

    const targetGroup = firstPage[0]?.groupId;
    expect(targetGroup).toBeDefined();
    if (!targetGroup) return;
    const filtered = await caller.job.list({
      queueName,
      status: "waiting",
      limit: 30,
      groupId: targetGroup,
    });
    expect(filtered.jobs.map((job) => job.groupId)).toEqual([targetGroup]);
    expect(filtered.searchMeta).toMatchObject({ capped: true });
    await expect(
      caller.job.search({ queueName, query: targetGroup }),
    ).resolves.toMatchObject({ partial: true });
    await expect(caller.queue.groups({ queueName })).resolves.toHaveLength(
      MAX_GROUPS,
    );
    await expect(
      caller.job.bulkRemoveByGroup({ queueName, groupId: targetGroup }),
    ).resolves.toMatchObject({ succeeded: 1, failed: 0 });
    expect(
      await queue.redis.exists(`${queue.namespace}:g:${targetGroup}`),
    ).toBe(0);
  },
  30_000,
);

// Cross-status scans read each status 100 jobs a round, raising the limit they
// pass the adapter as they go, so every waiting page before the last is capped
// by that limit. Stopping at a capped page read only the first 100 waiting jobs.
test.runIf(type === "groupmq")(
  "GroupMQ search and group removal read waiting jobs past the first batch",
  async () => {
    const queue = createQueue();
    await addJobs(queue, 300, (index) => ({
      groupId: `tenant-${index}`,
      data: { marker: `needle-${index}-x` },
      maxAttempts: 1,
    }));
    // The order every waiting scan reads the queue in.
    const waiting = await new GroupMQAdapter(queue, "Order").getJobs(
      "waiting",
      0,
      299,
    );
    expect(waiting).toHaveLength(300);
    const caller = appRouter.createCaller({
      queues: [{ queue, displayName: "First batch", type: "groupmq" }],
    });
    const queueName = queue.name;

    for (const target of [waiting[150], waiting[299]]) {
      const search = await caller.job.search({
        queueName,
        query: String(target?.data.marker),
      });
      expect(search.results.map(({ job }) => job.id)).toEqual([target?.id]);
      expect(search).toMatchObject({ partial: false, scanned: 300 });
    }

    const groupId = waiting[200]?.groupId ?? "";
    await expect(
      caller.job.bulkRemoveByGroup({ queueName, groupId }),
    ).resolves.toMatchObject({
      total: 1,
      succeeded: 1,
      failed: 0,
      scanned: 300,
      partial: false,
    });
    expect(await queue.redis.exists(`${queue.namespace}:g:${groupId}`)).toBe(0);
  },
  15_000,
);

test.runIf(type === "groupmq")(
  "GroupMQ group removal takes every job of a group spread through the queue",
  async () => {
    const queue = createQueue();
    // Three tenants' jobs interleave through all 250 waiting jobs.
    await addJobs(queue, 250, (index) => ({
      groupId: `tenant-${index % 3}`,
      data: { index },
      maxAttempts: 1,
    }));
    const groupSize = (groupId: string) =>
      queue.redis.zcard(`${queue.namespace}:g:${groupId}`);
    expect(await groupSize("tenant-1")).toBe(83);
    const caller = appRouter.createCaller({
      queues: [{ queue, displayName: "Spread group", type: "groupmq" }],
    });

    await expect(
      caller.job.bulkRemoveByGroup({
        queueName: queue.name,
        groupId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      total: 83,
      succeeded: 83,
      failed: 0,
      partial: false,
    });
    expect(await groupSize("tenant-1")).toBe(0);
    expect(await groupSize("tenant-0")).toBe(84);
    expect(await groupSize("tenant-2")).toBe(83);
  },
  15_000,
);

test.runIf(type === "groupmq")(
  "GroupMQ search and group removal read on through a cut group set, then say it was cut",
  async () => {
    const queue = createQueue();
    await addJobs(queue, MAX_GROUPS + 1, (index) => ({
      groupId: `tenant-${index}`,
      data: { marker: `needle-${index}-x` },
      maxAttempts: 1,
    }));
    // The first jobs of the slice of groups the scans can see, in their order.
    const waiting = await new GroupMQAdapter(queue, "Order").getJobs(
      "waiting",
      0,
      299,
    );
    expect(waiting).toHaveLength(300);
    const caller = appRouter.createCaller({
      queues: [{ queue, displayName: "Cut group set", type: "groupmq" }],
    });
    const queueName = queue.name;

    const target = waiting[150];
    const search = await caller.job.search({
      queueName,
      query: String(target?.data.marker),
    });
    expect(search.results.map(({ job }) => job.id)).toEqual([target?.id]);
    expect(search).toMatchObject({ partial: true });

    const groupId = waiting[250]?.groupId ?? "";
    await expect(
      caller.job.bulkRemoveByGroup({ queueName, groupId }),
    ).resolves.toMatchObject({
      total: 1,
      succeeded: 1,
      failed: 0,
      scanned: MAX_GROUPS,
      partial: true,
    });
    expect(await queue.redis.exists(`${queue.namespace}:g:${groupId}`)).toBe(0);
  },
  30_000,
);

test.runIf(type === "groupmq")(
  "GroupMQ search past 5,000 groups is partial even when the slice it sees runs out first",
  async () => {
    // A group whose only job is active holds no waiting job but stays in the
    // group set. Past 5,000 groups, the slice a scan sees can then run out
    // well inside its budget, and only the cut says jobs were left unread.
    const queue = createQueue();
    const busyGroups = MAX_GROUPS + 1;
    await addJobs(queue, busyGroups, (index) => ({
      groupId: `busy-${index}`,
      data: { busy: index },
      maxAttempts: 1,
    }));
    for (let start = 0; start < busyGroups; start += 500) {
      const reserved = await Promise.all(
        Array.from({ length: Math.min(500, busyGroups - start) }, (_, offset) =>
          queue.reserveAtomic(`busy-${start + offset}`),
        ),
      );
      expect(reserved).not.toContain(null);
    }
    await addJobs(queue, 150, (index) => ({
      groupId: `tenant-${index}`,
      data: { marker: `needle-${index}-x` },
      maxAttempts: 1,
    }));
    const waiting = await new GroupMQAdapter(queue, "Order").getJobs(
      "waiting",
      0,
      149,
    );
    // A few tenants may fall outside the slice; nearly all are inside it.
    expect(waiting.length).toBeGreaterThan(100);
    const caller = appRouter.createCaller({
      queues: [{ queue, displayName: "Busy groups", type: "groupmq" }],
    });

    const target = waiting.at(-1);
    const search = await caller.job.search({
      queueName: queue.name,
      query: String(target?.data.marker),
      statuses: ["waiting"],
    });
    expect(search.results.map(({ job }) => job.id)).toEqual([target?.id]);
    expect(search).toMatchObject({
      partial: true,
      scanLimitReached: true,
      scanned: waiting.length,
    });
  },
  30_000,
);
