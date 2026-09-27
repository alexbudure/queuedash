import { randomUUID } from "node:crypto";

import Bull from "bull";
import { Queue as BullMQQueue, Worker as BullMQWorker } from "bullmq";
import { Queue as BullMQ5Queue } from "bullmq-v5";
import Redis from "ioredis";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";

import { JobNotFoundError } from "../queue-adapters/base.adapter";
import { BullAdapter } from "../queue-adapters/bull.adapter";
import { BullMQAdapter } from "../queue-adapters/bullmq.adapter";
import { bullmqMajor, sleep, type } from "./test.utils";

// Every key these tests create lives under this prefix and is deleted after.
const prefix = `qd-integrity-${randomUUID().slice(0, 8)}`;
const redis = new Redis();
const open: { close: () => Promise<unknown> }[] = [];
const track = <T extends { close: () => Promise<unknown> }>(closable: T): T => {
  open.push(closable);
  return closable;
};
const queueName = () => `q-${randomUUID().slice(0, 8)}`;

const waitFor = async (
  condition: () => Promise<boolean>,
  timeoutMs = 3_000,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) return false;
    await sleep(25);
  }
  return true;
};

// What Redis answers when CLIENT is renamed away or not offered at all.
const noClientCommand = () =>
  new Error("ERR unknown command 'client', with args beginning with: 'LIST' ");

afterEach(async () => {
  vi.restoreAllMocks();
  for (const closable of open.splice(0).reverse()) await closable.close();
});

afterAll(async () => {
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(
      cursor,
      "MATCH",
      `${prefix}:*`,
      "COUNT",
      1000,
    );
    cursor = next;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== "0");
  await redis.quit();
});

describe.runIf(type === "bull")("Bull adapter", () => {
  test("Empty leaves repeatable jobs scheduled, and they keep firing", async () => {
    const queue = track(new Bull(queueName(), { prefix }));
    const adapter = new BullAdapter(queue, "Repeatable");
    const iteration = await queue.add("tick", {}, { repeat: { every: 1_000 } });
    await queue.add({ delayed: true }, { delay: 60_000 });
    await queue.add({ waiting: true });

    await adapter.empty();

    expect((await queue.getDelayed()).map((job) => job.id)).toEqual([
      iteration.id,
    ]);
    expect(await queue.getWaitingCount()).toBe(0);
    let fired = 0;
    void queue.process("tick", async () => {
      fired += 1;
    });
    // Each iteration schedules the next as it starts, so a second run shows
    // the repeatable itself survived, not just its leftover iteration.
    expect(await waitFor(async () => fired >= 2, 4_000)).toBe(true);
  }, 10_000);

  test("Empty keeps a paused queue paused, so jobs added later still wait", async () => {
    const queue = track(new Bull(queueName(), { prefix }));
    const adapter = new BullAdapter(queue, "Paused");
    const before = await queue.add({ before: true });
    await adapter.pause();
    const during = await queue.add({ during: true });

    await adapter.empty();

    for (const job of [before, during]) {
      expect(await redis.exists(queue.toKey(String(job.id)))).toBe(0);
    }
    expect(await adapter.isPaused()).toBe(true);
    expect(await redis.exists(queue.toKey("meta-paused"))).toBe(1);
    const added = await adapter.addJob({ after: true });
    expect(await redis.lrange(queue.toKey("paused"), 0, -1)).toEqual([
      String(added.id),
    ]);
    expect(await redis.llen(queue.toKey("wait"))).toBe(0);
  });

  test("Empty removes every job that has not started, with its data, and nothing else", async () => {
    const name = queueName();
    const queue = track(new Bull(name, { prefix }));
    const adapter = new BullAdapter(queue, "Removed");
    const worker = track(new Bull(name, { prefix }));
    void worker.process(async () => "done");
    const finished = await queue.add({ finished: true });
    expect(
      await waitFor(async () => (await queue.getCompletedCount()) === 1),
    ).toBe(true);
    await worker.close();

    const waiting = await queue.add({ waiting: true });
    await waiting.log("a log line");
    const prioritized = await queue.add({ prioritized: true }, { priority: 1 });
    const delayed = await queue.add({ delayed: true }, { delay: 60_000 });

    await adapter.empty();

    for (const job of [waiting, prioritized, delayed]) {
      expect(await redis.exists(queue.toKey(String(job.id)))).toBe(0);
    }
    expect(await redis.exists(queue.toKey(`${waiting.id}:logs`))).toBe(0);
    expect(await redis.exists(queue.toKey("priority"))).toBe(0);
    expect(await adapter.getJobCounts()).toMatchObject({
      waiting: 0,
      paused: 0,
      delayed: 0,
      completed: 1,
    });
    expect(await redis.exists(queue.toKey(String(finished.id)))).toBe(1);
  });

  test("ids that name the queue's own keys are not jobs", async () => {
    const name = queueName();
    const opts = { prefix, metrics: { maxDataPoints: 60 } };
    const queue = track(new Bull(name, opts));
    const adapter = new BullAdapter(queue, "Reserved ids");
    const worker = track(new Bull(name, opts));
    void worker.process(async () => {
      throw new Error("boom");
    });
    const failed = await queue.add({ fail: true });
    expect(
      await waitFor(async () => (await queue.getFailedCount()) === 1),
    ).toBe(true);
    await worker.close();
    await adapter.pause();

    // Both hashes are Bull's own: the pause flag and the failure metrics.
    const reserved = ["meta", "metrics:failed"];
    const hashes = () =>
      Promise.all(reserved.map((id) => redis.hgetall(queue.toKey(id))));
    const before = await hashes();
    expect(before[0]).toMatchObject({ paused: "1" });
    expect(before[1]).toHaveProperty("count", "1");
    for (const id of reserved) {
      expect(await adapter.getJob(id)).toBeNull();
      expect(await adapter.getJobStatus(id)).toBeNull();
      await expect(adapter.removeJob(id)).rejects.toThrow(JobNotFoundError);
      await expect(adapter.retryJob(id)).rejects.toThrow(JobNotFoundError);
      await expect(adapter.promoteJob(id)).rejects.toThrow(JobNotFoundError);
    }
    expect(await hashes()).toEqual(before);
    expect(await adapter.isPaused()).toBe(true);

    // Keys of any other type used to fail the lookup with WRONGTYPE.
    for (const id of ["failed", "id", "meta-paused"]) {
      expect(await adapter.getJob(id)).toBeNull();
      expect(await adapter.getJobStatus(id)).toBeNull();
      await expect(adapter.removeJob(id)).rejects.toThrow(JobNotFoundError);
    }

    // Real jobs are still found, repeatable iterations ("repeat:…") included.
    const iteration = await queue.add(
      "tick",
      {},
      { repeat: { every: 60_000 } },
    );
    expect((await adapter.getJob(String(iteration.id)))?.name).toBe("tick");
    expect(await adapter.getJobStatus(String(failed.id))).toBe("failed");
    await adapter.removeJob(String(failed.id));
    expect(await adapter.getJob(String(failed.id))).toBeNull();
  });

  test("the failed count is a single read, not a full job count", async () => {
    const name = queueName();
    const queue = track(new Bull(name, { prefix }));
    const adapter = new BullAdapter(queue, "Failed count");
    const worker = track(new Bull(name, { prefix }));
    void worker.process(async () => {
      throw new Error("boom");
    });
    await queue.add({ fail: true });
    expect(
      await waitFor(async () => (await queue.getFailedCount()) === 1),
    ).toBe(true);

    const getJobCounts = vi.spyOn(adapter, "getJobCounts");
    expect(await adapter.getFailedCount()).toBe(1);
    expect(getJobCounts).not.toHaveBeenCalled();
  });

  test("worker inspection without CLIENT is unavailable, not zero workers", async () => {
    const queue = track(new Bull(queueName(), { prefix }));
    const adapter = new BullAdapter(queue, "Workers");
    void queue.process(async () => "done");
    expect(
      await waitFor(
        async () => ((await adapter.getWorkers()) ?? []).length > 0,
      ),
    ).toBe(true);

    vi.spyOn(queue.client, "client").mockRejectedValue(noClientCommand());
    expect(await adapter.getWorkers()).toBeNull();
  });
});

describe.runIf(type === "bullmq")("BullMQ adapter", () => {
  test("ids that name the queue's own keys are not jobs", async () => {
    const name = queueName();
    const queue = track(new BullMQQueue(name, { prefix, connection: {} }));
    const adapter = new BullMQAdapter(queue, "Reserved ids");
    const worker = track(
      new BullMQWorker(
        name,
        async (job) => {
          if (job.data.fail) throw new Error("boom");
        },
        { prefix, connection: {}, metrics: { maxDataPoints: 60 } },
      ),
    );
    const completed = await queue.add("completes", {});
    const failed = await queue.add("fails", { fail: true });
    expect(
      await waitFor(
        async () =>
          (await queue.getCompletedCount()) === 1 &&
          (await queue.getFailedCount()) === 1,
      ),
    ).toBe(true);
    await worker.close();
    await queue.upsertJobScheduler(
      "nightly",
      { every: 60_000 },
      { name: "nightly" },
    );
    await queue.setGlobalConcurrency(3);
    await adapter.pause();

    // The queue's settings and pause flag, a job scheduler, and its metrics.
    const reserved = ["meta", "repeat:nightly", "metrics:completed"];
    const hashes = () =>
      Promise.all(
        reserved.map((id) => redis.hgetall(`${prefix}:${name}:${id}`)),
      );
    const before = await hashes();
    expect(before[0]).toMatchObject({ paused: "1", concurrency: "3" });
    expect(before[1]).toHaveProperty("every", "60000");
    expect(before[2]).toHaveProperty("count", "1");
    for (const id of reserved) {
      expect(await adapter.getJob(id)).toBeNull();
      expect(await adapter.getJobStatus(id)).toBeNull();
      await expect(adapter.removeJob(id)).rejects.toThrow(JobNotFoundError);
      await expect(adapter.retryJob(id)).rejects.toThrow(JobNotFoundError);
      await expect(adapter.promoteJob(id)).rejects.toThrow(JobNotFoundError);
      await expect(adapter.getJobLogs(id)).rejects.toThrow(JobNotFoundError);
    }
    expect(await hashes()).toEqual(before);
    expect(await adapter.isPaused()).toBe(true);
    expect(await queue.getGlobalConcurrency()).toBe(3);
    expect(await queue.getJobScheduler("nightly")).toBeTruthy();

    // Keys of any other type used to fail the lookup with WRONGTYPE.
    for (const id of ["failed", "completed", "events", "id"]) {
      expect(await adapter.getJob(id)).toBeNull();
      expect(await adapter.getJobStatus(id)).toBeNull();
      await expect(adapter.removeJob(id)).rejects.toThrow(JobNotFoundError);
    }

    // Real jobs are still found, a scheduler's own iterations included.
    const iteration = (await queue.getJobs()).find((job) =>
      job.id?.startsWith("repeat:nightly:"),
    );
    expect(iteration?.id).toBeDefined();
    expect((await adapter.getJob(String(iteration?.id)))?.name).toBe("nightly");
    expect(await adapter.getJobLogs(String(completed.id))).toEqual([]);
    expect(await adapter.getJobStatus(String(failed.id))).toBe("failed");
    await adapter.removeJob(String(failed.id));
    expect(await adapter.getJob(String(failed.id))).toBeNull();
  });

  test("the failed count is a single read, not a full job count", async () => {
    const name = queueName();
    const queue = track(new BullMQQueue(name, { prefix, connection: {} }));
    const adapter = new BullMQAdapter(queue, "Failed count");
    track(
      new BullMQWorker(
        name,
        async () => {
          throw new Error("boom");
        },
        { prefix, connection: {} },
      ),
    );
    await queue.add("fails", {});
    expect(
      await waitFor(async () => (await queue.getFailedCount()) === 1),
    ).toBe(true);

    const getJobCounts = vi.spyOn(adapter, "getJobCounts");
    expect(await adapter.getFailedCount()).toBe(1);
    expect(getJobCounts).not.toHaveBeenCalled();
  });

  test("offers the paused status on both majors", async () => {
    const queue = track(
      new BullMQQueue(queueName(), { prefix, connection: {} }),
    );
    const adapter = new BullMQAdapter(queue, "Paused status");

    expect(adapter.supports.statuses).toContain("paused");
    expect(adapter.canCleanStatus("paused")).toBe(true);
    expect(await adapter.getJobCounts()).toHaveProperty("paused", 0);
  });

  test.runIf(bullmqMajor === 5)(
    "lists and cleans BullMQ 5's paused list",
    async () => {
      const queue = track(
        new BullMQQueue(queueName(), { prefix, connection: {} }),
      );
      const adapter = new BullMQAdapter(queue, "Paused list");
      await adapter.pause();
      const jobs = await queue.addBulk([
        { name: "a", data: {} },
        { name: "b", data: {} },
      ]);

      expect(await adapter.getJobCounts()).toMatchObject({
        paused: 2,
        waiting: 0,
      });
      const listed = await adapter.getJobs("paused", 0, 9);
      expect(listed.map((job) => job.id).sort()).toEqual(
        jobs.map((job) => job.id).sort(),
      );
      await sleep(5);
      await adapter.clean("paused", 0);
      expect(await adapter.getJobCounts()).toMatchObject({ paused: 0 });
    },
  );

  test.runIf(bullmqMajor === 6)(
    "counts, lists and cleans the paused backlog a BullMQ 5 producer left",
    async () => {
      const name = queueName();
      const producer = track(
        new BullMQ5Queue(name, { prefix, connection: {} }),
      );
      await producer.pause();
      const jobs = await producer.addBulk(
        [1, 2, 3].map((index) => ({ name: "legacy", data: { index } })),
      );
      const ids = jobs.map((job) => String(job.id)).sort();
      const queue = track(new BullMQQueue(name, { prefix, connection: {} }));
      const adapter = new BullMQAdapter(queue, "Mixed majors");

      expect(await adapter.isPaused()).toBe(true);
      // Empty's confirmation counts from these; it used to say 0 here.
      expect(await adapter.getJobCounts()).toMatchObject({
        paused: 3,
        waiting: 0,
      });
      const listed = await adapter.getJobs("paused", 0, 9);
      expect(listed.map((job) => job.id).sort()).toEqual(ids);

      await sleep(5);
      await adapter.clean("paused", 0);
      expect(await adapter.getJobCounts()).toMatchObject({ paused: 0 });
      for (const id of ids) {
        expect(await redis.exists(`${prefix}:${name}:${id}`)).toBe(0);
      }
    },
  );

  test("worker inspection without CLIENT is unavailable, not zero workers", async () => {
    const name = queueName();
    const connection = new Redis({ maxRetriesPerRequest: null });
    track({ close: () => connection.quit() });
    const queue = track(new BullMQQueue(name, { prefix, connection }));
    const adapter = new BullMQAdapter(queue, "Workers");
    track(new BullMQWorker(name, async () => {}, { prefix, connection: {} }));
    expect(
      await waitFor(
        async () => ((await adapter.getWorkers()) ?? []).length > 0,
      ),
    ).toBe(true);

    // BullMQ swallows this and answers with a placeholder "worker".
    vi.spyOn(connection, "client").mockRejectedValue(noClientCommand());
    expect(await adapter.getWorkers()).toBeNull();
  });
});
