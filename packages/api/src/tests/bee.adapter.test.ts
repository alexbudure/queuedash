import { randomBytes } from "node:crypto";

import BeeQueue from "bee-queue";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { JobNotFoundError } from "../queue-adapters/base.adapter";
import { BeeAdapter } from "../queue-adapters/bee.adapter";
import { type } from "./test.utils";

type ScanCallback = (error: Error | null, result: [string, string[]]) => void;
type HmgetCallback = (
  error: Error | null,
  values: Array<string | null>,
) => void;

test("un-tokened Bee set pages use isolated stateless scans", async () => {
  const scanCallbacks: ScanCallback[] = [];
  const sscan = vi.fn(
    (
      _key: string,
      _cursor: string,
      _countKeyword: "COUNT",
      _count: number,
      callback: ScanCallback,
    ) => {
      scanCallbacks.push(callback);
    },
  );
  const hmget = vi.fn((_key: string, ...fieldsThenCallback: unknown[]) => {
    const callback = fieldsThenCallback.pop() as HmgetCallback;
    callback(
      null,
      (fieldsThenCallback as string[]).map((id) =>
        JSON.stringify({
          data: { id },
          options: { timestamp: 0 },
          status: "succeeded",
        }),
      ),
    );
  });
  const queue = {
    name: "isolated-bee-pages",
    ready: vi.fn().mockResolvedValue(undefined),
    client: { hmget, sscan },
    toKey: (status: string) => `bq:isolated-bee-pages:${status}`,
  } as unknown as BeeQueue;
  const adapter = new BeeAdapter(queue, "Isolated Bee pages");

  const firstPage = adapter.getJobs("completed", 0, 0);
  const secondPage = adapter.getJobs("completed", 1, 1);

  await vi.waitFor(() => {
    expect(sscan).toHaveBeenCalledTimes(2);
  });
  expect(sscan.mock.calls.map((call) => call[1])).toEqual(["0", "0"]);

  scanCallbacks[0]?.(null, ["0", ["first-a", "first-b"]]);
  scanCallbacks[1]?.(null, ["0", ["second-a", "second-b"]]);

  await expect(firstPage).resolves.toMatchObject([{ id: "first-a" }]);
  await expect(secondPage).resolves.toMatchObject([{ id: "second-b" }]);
});

// These run against a real queue of whichever Bee-Queue major the suite
// resolves (BEE_MAJOR=1 aliases the older one), so they only run in the Bee
// suites. Every key lives under a unique prefix and is deleted afterwards.
describe.runIf(type === "bee")("Bee-Queue adapter on a real queue", () => {
  const prefix = `qd-bee-adapter-${randomBytes(4).toString("hex")}`;
  const name = "bee-adapter";
  const queues: BeeQueue[] = [];
  const succeededIds: string[] = [];
  const failedIds: string[] = [];
  let producer: BeeQueue;

  // Settings default to storeJobs: true, the Bee-Queue default a host app runs
  // with, so the host caches every job its own getJob() returns.
  const openQueue = async (settings: BeeQueue.QueueSettings = {}) => {
    const queue = new BeeQueue(name, { prefix, ...settings });
    queues.push(queue);
    await queue.ready();
    return queue;
  };

  beforeAll(async () => {
    producer = await openQueue({ getEvents: false, isWorker: false });
    const worker = await openQueue({ getEvents: false });
    worker.process(4, async (job: BeeQueue.Job<{ index: number }>) => {
      if (job.data.index % 3 === 0) {
        throw new Error(`Bee job ${job.data.index} failed`);
      }
      return job.data.index;
    });
    const jobs = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        producer.createJob({ index }).save(),
      ),
    );
    await vi.waitFor(
      async () => {
        const health = await producer.checkHealth();
        expect(health.succeeded + health.failed).toBe(jobs.length);
      },
      { interval: 50, timeout: 10_000 },
    );
    await worker.close();
    for (const job of jobs) {
      const index = (job.data as { index: number }).index;
      (index % 3 === 0 ? failedIds : succeededIds).push(job.id);
    }
  }, 20_000);

  afterAll(async () => {
    await Promise.allSettled(queues.map((queue) => queue.close()));
    const redis = new Redis();
    try {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          "MATCH",
          `${prefix}:*`,
          "COUNT",
          1_000,
        );
        cursor = nextCursor;
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== "0");
    } finally {
      redis.disconnect();
    }
  }, 20_000);

  test("a failed job's reason is its message line, not its stack", async () => {
    // A queue that never saw these jobs, so no stale local copy is in play.
    const host = await openQueue({ getEvents: false, isWorker: false });
    const adapter = new BeeAdapter(host, name);
    const failedId = failedIds[0];
    expect(failedId).toBeDefined();
    if (!failedId) return;

    const failed = await adapter.getJob(failedId);
    expect(failed?.failedReason).toBe("Error: Bee job 0 failed");
    expect(failed?.stacktrace?.[0]).toMatch(/^Error: Bee job 0 failed\n\s+at /);

    const page = await adapter.getJobs("failed", 0, 99);
    expect(page).toHaveLength(failedIds.length);
    for (const job of page) {
      expect(job.failedReason).toMatch(/^Error: Bee job \d+ failed$/);
      expect(job.stacktrace?.[0]).toMatch(/\n\s+at /);
    }
  });

  test("reading jobs leaves the host queue's job cache as it was", async () => {
    const host = await openQueue({ isWorker: false });
    const tracked = await host.createJob({ tracked: true }).save();
    expect(host.jobs.size).toBe(1);
    expect(host.jobs.get(tracked.id)).toBe(tracked);
    const adapter = new BeeAdapter(host, name);
    const [readId, removedId] = succeededIds;
    expect(readId && removedId).toBeTruthy();
    if (!readId || !removedId) return;

    await expect(adapter.getJobs("completed", 0, 99)).resolves.toHaveLength(
      succeededIds.length,
    );
    await expect(adapter.getJobs("failed", 0, 99)).resolves.toHaveLength(
      failedIds.length,
    );
    await expect(adapter.getJobs("waiting", 0, 99)).resolves.toMatchObject([
      { id: tracked.id },
    ]);
    const scanToken = adapter.beginJobScan("completed");
    expect(scanToken).toBeDefined();
    if (!scanToken) return;
    try {
      await adapter.getJobs("completed", 0, 49, 5_001, scanToken);
    } finally {
      adapter.endJobScan(scanToken);
    }
    await expect(adapter.getJob(readId)).resolves.toMatchObject({
      id: readId,
    });
    await expect(adapter.getJobStatus(readId)).resolves.toBe("completed");
    await adapter.removeJob(removedId);
    await expect(adapter.getJob(removedId)).resolves.toBeNull();

    expect(host.jobs.size).toBe(1);
    expect(host.jobs.get(tracked.id)).toBe(tracked);
  });

  test("lookups read Redis rather than the host's copy of a deleted job", async () => {
    const host = await openQueue({ getEvents: false, isWorker: false });
    const deletedId = succeededIds[2];
    expect(deletedId).toBeDefined();
    if (!deletedId) return;
    // The host looked this job up itself, then another process deleted it.
    const hostCopy = await host.getJob(deletedId);
    expect(hostCopy).toBeTruthy();
    await producer.removeJob(deletedId);
    const adapter = new BeeAdapter(host, name);

    await expect(adapter.getJob(deletedId)).resolves.toBeNull();
    await expect(adapter.getJobStatus(deletedId)).resolves.toBeNull();
    await expect(adapter.removeJob(deletedId)).rejects.toBeInstanceOf(
      JobNotFoundError,
    );
    // The host's own entry is its business: the adapter never evicts it.
    expect(host.jobs.get(deletedId)).toBe(hostCopy);
  });

  test("implements the adapter contract", async () => {
    const adapter = new BeeAdapter(producer, name);
    expect(adapter.supports.addJobOptionKeys).toEqual([]);
    await expect(adapter.getWorkers()).resolves.toBeNull();
    await expect(adapter.removeJob("missing-job")).rejects.toBeInstanceOf(
      JobNotFoundError,
    );

    const checkHealth = vi.spyOn(producer, "checkHealth");
    try {
      await expect(adapter.getFailedCount()).resolves.toBe(failedIds.length);
      expect(checkHealth).not.toHaveBeenCalled();
    } finally {
      checkHealth.mockRestore();
    }
    await expect(adapter.getJobCounts()).resolves.toMatchObject({
      failed: failedIds.length,
    });
  });
});
