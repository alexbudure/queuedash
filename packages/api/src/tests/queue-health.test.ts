import { afterEach, expect, it, vi } from "vitest";

import { appRouter } from "../routers/_app";
import type { Context } from "../trpc";

afterEach(() => vi.useRealTimers());

it("returns healthy queues when another Redis client stalls, without queuing more reads", async () => {
  vi.useFakeTimers();
  let finishRead!: (counts: { failed: number }) => void;
  const getJobCounts = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    )
    .mockResolvedValue({ failed: 3 });
  const isPaused = vi.fn().mockResolvedValue(false);
  const caller = appRouter.createCaller({
    queues: [
      {
        type: "bullmq",
        displayName: "Unavailable",
        queue: { name: "unavailable", getJobCounts, isPaused },
      },
      {
        type: "bullmq",
        displayName: "Healthy",
        queue: {
          name: "healthy",
          getJobCounts: async () => ({ failed: 2 }),
          isPaused: async () => false,
        },
      },
    ],
  } as unknown as Context);

  const list = caller.queue.list();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(await list).toMatchObject([
    { name: "unavailable", failedCount: null, paused: null },
    { name: "healthy", failedCount: 2, paused: false },
  ]);
  await Promise.all(Array.from({ length: 10 }, () => caller.queue.list()));
  expect(getJobCounts).toHaveBeenCalledTimes(1);
  expect(isPaused).toHaveBeenCalledTimes(1);

  finishRead({ failed: 3 });
  await vi.advanceTimersByTimeAsync(0);
  expect(await caller.queue.list()).toMatchObject([
    { failedCount: 3, paused: false },
    { failedCount: 2, paused: false },
  ]);
  expect(getJobCounts).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not retry a stalled health command when its sibling rejects", async () => {
  vi.useFakeTimers();
  const getJobCounts = vi
    .fn()
    .mockRejectedValue(new Error("Redis unavailable"));
  const isPaused = vi.fn(() => new Promise<boolean>(() => {}));
  const caller = appRouter.createCaller({
    queues: [
      {
        type: "bullmq",
        displayName: "Unavailable",
        queue: { name: "unavailable", getJobCounts, isPaused },
      },
    ],
  } as unknown as Context);
  const list = caller.queue.list();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(await list).toMatchObject([{ failedCount: null, paused: null }]);
  await caller.queue.list();
  expect(getJobCounts).toHaveBeenCalledTimes(1);
  expect(isPaused).toHaveBeenCalledTimes(1);
});
