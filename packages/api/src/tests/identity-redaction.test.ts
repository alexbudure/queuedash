import { expect, it, vi } from "vitest";

import { presentJob } from "../presentation";
import { getQueueRegistry } from "../queue-registry";
import { appRouter } from "../routers/_app";
import type { Context } from "../trpc";

it.each(["bee", "groupmq"] as const)(
  "hides %s identity aliases from responses and search",
  async (type) => {
    const identity = "private-tenant-identity";
    const queue = {
      name: "identity-test",
      getJob: async () => ({
        id: type === "bee" ? identity : "job-1",
        groupId: type === "groupmq" ? identity : undefined,
        data: {},
        options: { timestamp: Date.now() },
        timestamp: Date.now(),
      }),
    };
    const ctx = {
      queues: [{ queue, displayName: "Identity test", type }],
      privacy: {
        redact: {
          keys: [type === "bee" ? "id" : "groupId"],
          replacement: "hidden",
        },
      },
    } as unknown as Context;
    const [{ adapter }] = await getQueueRegistry(ctx).list();
    const raw = (await adapter.getJob("job-1"))!;
    expect(raw.name).toBe(identity);
    const presented = presentJob(raw, ctx.privacy);
    expect(presented.name).toBe("hidden");
    expect(JSON.stringify(presented)).not.toContain(identity);
    expect(presentJob({ ...raw, name: "Public name" }, ctx.privacy).name).toBe(
      "Public name",
    );
    vi.spyOn(adapter, "getJobs").mockResolvedValue([raw]);
    vi.spyOn(adapter, "getJobStatus").mockResolvedValue("completed");
    const caller = appRouter.createCaller(ctx);
    expect(
      (
        await caller.job.search({
          queueName: queue.name,
          query: identity,
          statuses: ["completed"],
        })
      ).results,
    ).toEqual([]);
    expect(
      (
        await caller.job.list({
          queueName: queue.name,
          status: "completed",
          query: identity,
          limit: 10,
        })
      ).jobs,
    ).toEqual([]);
  },
);
