import type { Context } from "../trpc";
import { appRouter } from "./_app";
import { test, expect } from "vitest";
// import type { inferProcedureInput } from "@trpc/server";

test("list queues", async () => {
  const ctx: Context = {
    opts: {},
    queues: [
      {
        name: "test",
        displayName: "Test",
      },
    ],
  };

  const caller = appRouter.createCaller(ctx);

  // const input: inferProcedureInput<AppRouter["post"]["add"]> = {
  //   text: "hello test",
  //   title: "hello test",
  // };

  const queues = await caller.queue.list();

  expect(queues).toMatchObject(ctx.queues);
});
