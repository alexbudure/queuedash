import { describe, expect, test } from "vitest";

import { percentile, summarizeRunTimes } from "../run-times";

describe("percentile", () => {
  test("is a nearest-rank value from the list, never an interpolation", () => {
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(sorted, 0.5)).toBe(50);
    expect(percentile(sorted, 0.95)).toBe(100);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe("summarizeRunTimes", () => {
  const now = 1_000_000_000;
  const minute = 60_000;

  test("counts only runs that finished inside the window", () => {
    const summary = summarizeRunTimes(
      [
        { at: now - 2 * minute, ms: 100 },
        { at: now - 30 * minute, ms: 300 },
        { at: now - 59 * minute, ms: 200 },
        // Before the window, and a clock ahead of this server's.
        { at: now - 61 * minute, ms: 9_000 },
        { at: now + minute, ms: 9_000 },
      ],
      { now, minutes: 60, buckets: 4 },
    );

    expect(summary.count).toBe(3);
    expect(summary.p50).toBe(200);
    expect(summary.p95).toBe(300);
  });

  test("gives each slice of the window its median, oldest first", () => {
    const summary = summarizeRunTimes(
      [
        { at: now - 55 * minute, ms: 100 },
        { at: now - 50 * minute, ms: 300 },
        { at: now - 48 * minute, ms: 200 },
        { at: now - 5 * minute, ms: 50 },
      ],
      { now, minutes: 60, buckets: 4 },
    );

    expect(summary.buckets).toEqual([200, null, null, 50]);
  });

  test("an empty window has no percentiles", () => {
    expect(summarizeRunTimes([], { now, minutes: 60, buckets: 3 })).toEqual({
      count: 0,
      p50: null,
      p95: null,
      buckets: [null, null, null],
    });
  });
});
