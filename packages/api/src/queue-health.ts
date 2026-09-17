import type { QueueAdapter } from "./queue-adapters/base.adapter";

type QueueHealth = { paused: boolean; failedCount: number };
const HEALTH_TIMEOUT_MS = 1_000;
const pendingHealth = new WeakMap<QueueAdapter, Promise<QueueHealth | null>>();

export const getQueueHealth = (
  adapter: QueueAdapter,
): Promise<QueueHealth | null> => {
  const pending = pendingHealth.get(adapter);
  if (pending) return pending;

  const read = Promise.allSettled([
    adapter.getJobCounts(),
    adapter.isPaused(),
  ]).then(([counts, paused]): QueueHealth | null =>
    counts.status === "fulfilled" && paused.status === "fulfilled"
      ? { paused: paused.value, failedCount: counts.value.failed ?? 0 }
      : null,
  );
  let timeout: ReturnType<typeof setTimeout>;
  const bounded = Promise.race([
    read,
    new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), HEALTH_TIMEOUT_MS);
    }),
  ]);
  pendingHealth.set(adapter, bounded);

  // After a timeout, reuse the settled null result until BOTH underlying
  // commands finish. Polling must not keep adding commands to an offline client.
  void read.then(() => {
    clearTimeout(timeout);
    pendingHealth.delete(adapter);
  });
  return bounded;
};
