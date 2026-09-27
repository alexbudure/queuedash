import { afterEach, expect, it, vi } from "vitest";

import { appRouter } from "../routers/_app";
import type { Context } from "../trpc";

afterEach(() => vi.useRealTimers());

it("returns healthy queues when another Redis client stalls, without queuing more reads", async () => {
  vi.useFakeTimers();
  let finishRead!: (failedCount: number) => void;
  const getFailedCount = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    )
    .mockResolvedValue(3);
  const getJobCounts = vi.fn().mockResolvedValue({ failed: 3 });
  const isPaused = vi.fn().mockResolvedValue(false);
  const caller = appRouter.createCaller({
    queues: [
      {
        type: "bullmq",
        displayName: "Unavailable",
        queue: { name: "unavailable", getFailedCount, getJobCounts, isPaused },
      },
      {
        type: "bullmq",
        displayName: "Healthy",
        queue: {
          name: "healthy",
          getFailedCount: async () => 2,
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
  expect(getFailedCount).toHaveBeenCalledTimes(1);
  expect(isPaused).toHaveBeenCalledTimes(1);

  finishRead(3);
  await vi.advanceTimersByTimeAsync(0);
  expect(await caller.queue.list()).toMatchObject([
    { failedCount: 3, paused: false },
    { failedCount: 2, paused: false },
  ]);
  expect(getFailedCount).toHaveBeenCalledTimes(2);
  // Polled for every queue on every page: never a full job count.
  expect(getJobCounts).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not retry a stalled health command when its sibling rejects", async () => {
  vi.useFakeTimers();
  const getFailedCount = vi
    .fn()
    .mockRejectedValue(new Error("Redis unavailable"));
  const isPaused = vi.fn(() => new Promise<boolean>(() => {}));
  const caller = appRouter.createCaller({
    queues: [
      {
        type: "bullmq",
        displayName: "Unavailable",
        queue: { name: "unavailable", getFailedCount, isPaused },
      },
    ],
  } as unknown as Context);
  const list = caller.queue.list();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(await list).toMatchObject([{ failedCount: null, paused: null }]);
  await caller.queue.list();
  expect(getFailedCount).toHaveBeenCalledTimes(1);
  expect(isPaused).toHaveBeenCalledTimes(1);
});
