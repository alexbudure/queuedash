/** When a job finished and how long its last run took, from its timestamps. */
export type RunSample = { at: number; ms: number };

export type RunTimeSummary = {
  /** Jobs that finished inside the window. */
  count: number;
  p50: number | null;
  p95: number | null;
  /** The median run time in each equal slice of the window, oldest first;
   *  null where nothing finished. */
  buckets: Array<number | null>;
};

/** Nearest-rank percentile of an ascending list: always a real run time. */
export const percentile = (sorted: readonly number[], fraction: number) =>
  sorted.length === 0
    ? null
    : (sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? null);

export const summarizeRunTimes = (
  runs: readonly RunSample[],
  { now, minutes, buckets }: { now: number; minutes: number; buckets: number },
): RunTimeSummary => {
  const windowMs = minutes * 60_000;
  const since = now - windowMs;
  const slices = Array.from({ length: buckets }, () => [] as number[]);
  const inWindow: number[] = [];
  for (const run of runs) {
    if (run.at < since || run.at > now) continue;
    inWindow.push(run.ms);
    const slice = Math.min(
      buckets - 1,
      Math.floor(((run.at - since) / windowMs) * buckets),
    );
    slices[slice]?.push(run.ms);
  }

  const ascending = (left: number, right: number) => left - right;
  inWindow.sort(ascending);
  return {
    count: inWindow.length,
    p50: percentile(inWindow, 0.5),
    p95: percentile(inWindow, 0.95),
    buckets: slices.map((slice) => percentile(slice.sort(ascending), 0.5)),
  };
};
