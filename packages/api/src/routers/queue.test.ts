import type { Context } from "../trpc";
import { queueDashRouter } from "./_app";
import { test, expect } from "vitest";
import Bull from "bull";
// import type { inferProcedureInput } from "@trpc/server";

test("list queues", async () => {
  const ctx: Context = {
    queues: [
      {
        queue: new Bull("test"),
        displayName: "Test",
        type: "bull",
      },
    ],
  };

  const caller = queueDashRouter.createCaller(ctx);

  // const input: inferProcedureInput<AppRouter["post"]["add"]> = {
  //   text: "hello test",
  //   title: "hello test",
  // };

  const queues = await caller.queue.list();

  expect(queues).toMatchObject(ctx.queues);
});
