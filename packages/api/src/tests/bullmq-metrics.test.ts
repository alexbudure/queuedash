import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";

import { BullMQAdapter } from "../queue-adapters/bullmq.adapter";
import { bullmqMajor, sleep, type } from "./test.utils";

// BullMQ's own per-minute metrics code, taken verbatim from the major under
// test and driven with chosen timestamps: the same call a worker's
// moveToFinished makes, without waiting hours for the minutes to pass.
const localRequire = createRequire(import.meta.url);
const includes = join(
  dirname(
    localRequire.resolve(
      `${bullmqMajor === 5 ? "bullmq-v5" : "bullmq"}/package.json`,
    ),
  ),
  "dist/cjs/commands/includes",
);
const RECORD_SCRIPT = [
  "local rcall = redis.call",
  readFileSync(join(includes, "batches.lua"), "utf8"),
  readFileSync(join(includes, "collectMetrics.lua"), "utf8"),
  // ARGV[1]: maxDataPoints; then (timestamp, jobs) pairs, oldest first.
  `for i = 2, #ARGV, 2 do
    for _ = 1, tonumber(ARGV[i + 1]) do
      collectMetrics(KEYS[1], KEYS[2], ARGV[1], ARGV[i])
    end
  end`,
].join("\n");

// Half a minute into 12:00, so "now" is inside a minute, not on its edge.
const NOW = Date.UTC(2026, 0, 15, 12, 0, 30);
const CURRENT_MINUTE = NOW - 30_000;

// Every key these tests create lives under this prefix and is deleted after.
const prefix = `qd-metrics-${randomUUID().slice(0, 8)}`;
const redis = new Redis();
const open: Queue[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const queue of open.splice(0)) await queue.close();
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

const setup = async () => {
  const queue = new Queue(`q-${randomUUID().slice(0, 8)}`, {
    prefix,
    connection: {},
  });
  open.push(queue);
  await queue.waitUntilReady();
  return { queue, adapter: new BullMQAdapter(queue, "Metrics") };
};

/** `jobs` finishing in each minute from `from` down to `to` minutes ago. */
const minutes = (
  from: number,
  to: number,
  jobs: number,
): [minutesAgo: number, jobs: number][] =>
  Array.from({ length: from - to + 1 }, (_, index) => [from - index, jobs]);

const record = async (
  queue: Queue,
  finishes: [minutesAgo: number, jobs: number][],
  maxDataPoints = 20_160,
) => {
  const key = `${prefix}:${queue.name}:metrics:completed`;
  const args = finishes.flatMap(([minutesAgo, jobs]) => [
    CURRENT_MINUTE - minutesAgo * 60_000 + 5_000,
    jobs,
  ]);
  await redis.eval(
    RECORD_SCRIPT,
    2,
    key,
    `${key}:data`,
    maxDataPoints,
    ...args,
  );
};

const metricsAtNoon = async (
  adapter: BullMQAdapter,
  start: number,
  end: number,
) => {
  const now = vi.spyOn(Date, "now").mockReturnValue(NOW);
  try {
    return await adapter.getMetrics("completed", start, end);
  } finally {
    now.mockRestore();
  }
};

const repeat = (value: number, times: number) =>
  Array.from({ length: times }, () => value);

describe.runIf(type === "bullmq")("BullMQ metrics", () => {
  test("a window holds exactly end - start minutes, newest first, the current one included", async () => {
    const { queue, adapter } = await setup();
    // 100 jobs a minute for three hours, and 50 so far this minute.
    await record(queue, [...minutes(180, 1, 100), [0, 50]]);

    expect(await metricsAtNoon(adapter, 0, 1)).toMatchObject({
      data: [50],
      count: 50,
      previousCount: 100,
      coveredMinutes: 1,
    });
    const lastHour = await metricsAtNoon(adapter, 0, 60);
    expect(lastHour.data).toEqual([50, ...repeat(100, 59)]);
    expect(lastHour).toMatchObject({
      count: 5_950,
      previousCount: 6_000,
      coveredMinutes: 60,
    });
    // A window that starts in the past counts back from now as well.
    expect(await metricsAtNoon(adapter, 5, 10)).toMatchObject({
      data: repeat(100, 5),
      count: 500,
      previousCount: 500,
      coveredMinutes: 5,
    });
  });

  test("an idle queue reads zero from its last finish until now", async () => {
    const { queue, adapter } = await setup();
    // Busy until ten minutes ago; nothing has finished since.
    await record(queue, minutes(70, 10, 100));

    expect(await metricsAtNoon(adapter, 0, 5)).toMatchObject({
      data: repeat(0, 5),
      count: 0,
      previousCount: 0,
      coveredMinutes: 5,
    });
    const quarter = await metricsAtNoon(adapter, 0, 15);
    expect(quarter.data).toEqual([...repeat(0, 10), ...repeat(100, 5)]);
    expect(quarter.count).toBe(500);
  });

  test("the previous window is the same length, right before this one", async () => {
    const { queue, adapter } = await setup();
    // 100 a minute until an hour ago, 40 a minute since.
    await record(queue, [...minutes(200, 60, 100), ...minutes(59, 0, 40)]);

    const lastHour = await metricsAtNoon(adapter, 0, 60);
    expect(lastHour).toMatchObject({ count: 2_400, previousCount: 6_000 });
    // BullMQ's own prevCount is a lifetime total, no baseline for a trend.
    expect(lastHour.meta.prevCount).toBe(141 * 100 + 59 * 40);
  });

  test("a young queue covers only the minutes since its first finish", async () => {
    const { queue, adapter } = await setup();
    await record(queue, minutes(5, 0, 100));

    const lastHour = await metricsAtNoon(adapter, 0, 60);
    expect(lastHour.data).toEqual([...repeat(100, 6), ...repeat(0, 54)]);
    expect(lastHour).toMatchObject({
      count: 600,
      coveredMinutes: 6,
      previousCount: null,
    });
    // Its history does reach back past the last minute.
    expect(await metricsAtNoon(adapter, 0, 1)).toMatchObject({
      coveredMinutes: 1,
      previousCount: 100,
    });
  });

  test("history BullMQ trimmed to maxDataPoints has no earlier window", async () => {
    const { queue, adapter } = await setup();
    await record(queue, minutes(180, 0, 100), 60);

    expect(await metricsAtNoon(adapter, 0, 60)).toMatchObject({
      count: 6_000,
      coveredMinutes: 60,
      previousCount: null,
    });
  });

  test("a queue that never recorded metrics has no history", async () => {
    const { adapter } = await setup();

    const lastHour = await metricsAtNoon(adapter, 0, 60);
    expect(lastHour.data).toEqual(repeat(0, 60));
    expect(lastHour).toMatchObject({
      count: 0,
      coveredMinutes: 0,
      previousCount: null,
    });
  });

  test("reads what a BullMQ worker records", async () => {
    const { queue, adapter } = await setup();
    const worker = new Worker(queue.name, async () => {}, {
      prefix,
      connection: {},
      metrics: { maxDataPoints: 60 },
    });
    try {
      await queue.addBulk(
        [1, 2, 3].map((index) => ({ name: "job", data: { index } })),
      );
      const deadline = Date.now() + 3_000;
      while ((await queue.getCompletedCount()) < 3 && Date.now() < deadline) {
        await sleep(25);
      }
    } finally {
      await worker.close();
    }

    // Two minutes, in case the jobs straddled a minute boundary.
    const recent = await adapter.getMetrics("completed", 0, 2);
    expect(recent.count).toBe(3);
    expect(recent.coveredMinutes).toBeGreaterThanOrEqual(1);
  });

  test("rejects windows that are not whole minutes ago with start < end", async () => {
    const { adapter } = await setup();
    for (const [start, end] of [
      [0, 0],
      [5, 1],
      [-1, 5],
      [0, 1.5],
      [0, 80_641],
    ]) {
      await expect(adapter.getMetrics("completed", start, end)).rejects.toThrow(
        RangeError,
      );
    }
  });
});
