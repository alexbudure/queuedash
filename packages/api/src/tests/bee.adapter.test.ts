import type BeeQueue from "bee-queue";
import { expect, test, vi } from "vitest";

import { BeeAdapter } from "../queue-adapters/bee.adapter";

type ScanCallback = (error: Error | null, result: [string, string[]]) => void;

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
  const queue = {
    name: "isolated-bee-pages",
    ready: vi.fn().mockResolvedValue(undefined),
    client: { sscan },
    toKey: (status: string) => `bq:isolated-bee-pages:${status}`,
    getJob: vi.fn(async (id: string) => ({
      id,
      data: { id },
      options: { timestamp: 0 },
      status: "succeeded",
    })),
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
