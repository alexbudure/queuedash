import { createHash } from "node:crypto";

import { expect, it, vi } from "vitest";

import { presentJob } from "../presentation";
import type { AdaptedJob } from "../queue-adapters/base.adapter";
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
      // The Bee adapter reads jobs from the queue's jobs hash rather than
      // through getJob(), so the Bee job's stored JSON is served here.
      ready: async () => undefined,
      toKey: (key: string) => `bq:identity-test:${key}`,
      client: {
        hmget: (_key: string, ...fieldsThenCallback: unknown[]) => {
          const callback = fieldsThenCallback.pop() as (
            error: null,
            values: string[],
          ) => void;
          callback(
            null,
            fieldsThenCallback.map(() =>
              JSON.stringify({ data: {}, options: { timestamp: Date.now() } }),
            ),
          );
        },
      },
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
    const raw = (await adapter.getJob(type === "bee" ? identity : "job-1"))!;
    expect(raw.name).toBe(identity);
    const presented = presentJob(raw, ctx.privacy);
    expect(presented.name).toBe("hidden");
    expect(JSON.stringify(presented)).not.toContain(identity);
    // A hidden job id becomes a pseudonym; a hidden group stays the plain
    // replacement.
    expect(presented).toMatchObject(
      type === "bee"
        ? { id: expect.stringMatching(/^hidden:[0-9a-f]{16}$/u) }
        : { id: "job-1", groupId: "hidden" },
    );
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

it("gives each hidden job id its own stable, keyed pseudonym", async () => {
  const privacy = { redact: { keys: ["id"], replacement: "hidden" } };
  const ids = [
    "alice@example.com",
    "bob@example.com",
    "order-2026-0001",
    "order-2026-0002",
  ];
  const rawJobs: AdaptedJob[] = ids.map((id) => ({
    id,
    name: "send-receipt",
    data: { total: 42 },
    opts: { attempts: 3, jobId: id } as AdaptedJob["opts"],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    processedAt: null,
    finishedAt: null,
    retriedAt: null,
  }));

  const presented = rawJobs.map((job) => presentJob(job, privacy));
  const pseudonyms = presented.map(({ id }) => id);
  expect(new Set(pseudonyms).size).toBe(ids.length);
  expect(rawJobs.map((job) => presentJob(job, privacy).id)).toEqual(pseudonyms);
  for (const job of presented) {
    expect(job.id).toMatch(/^hidden:[0-9a-f]{16}$/u);
    // `opts.jobId` names the same job, so it carries the same pseudonym.
    expect(job.opts).toMatchObject({ jobId: job.id });
  }
  const sequential = ["1", "2", "3"].map(
    (id) => presentJob({ ...rawJobs[0]!, id, opts: {} }, privacy).id,
  );
  expect(new Set(sequential).size).toBe(3);
  // Keyed: hashing a guessed id does not reveal which row it is.
  const unkeyed = createHash("sha256")
    .update(ids[0]!)
    .digest("hex")
    .slice(0, 16);
  expect(pseudonyms[0]).not.toBe(`hidden:${unkeyed}`);

  // The same ids reach the UI through job.list, poll after poll.
  const queue = { name: "pseudonym-test" };
  const ctx = {
    queues: [{ queue, displayName: "Pseudonym test", type: "bee" }],
    privacy,
  } as unknown as Context;
  const [{ adapter }] = await getQueueRegistry(ctx).list();
  vi.spyOn(adapter, "getJobs").mockResolvedValue(rawJobs);
  vi.spyOn(adapter, "getJobCounts").mockResolvedValue({
    completed: rawJobs.length,
  });
  const caller = appRouter.createCaller(ctx);
  const list = () =>
    caller.job.list({
      queueName: queue.name,
      status: "completed",
      limit: 10,
    });
  const page = await list();
  expect(page.jobs.map(({ id }) => id)).toEqual(pseudonyms);
  expect((await list()).jobs.map(({ id }) => id)).toEqual(pseudonyms);
  const response = JSON.stringify(page);
  for (const id of ids) expect(response).not.toContain(id);
});
