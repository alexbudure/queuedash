import { Elysia } from "elysia";
import { trpc } from "@elysiajs/trpc";
import type { Context } from "../routers/_app";
import { appRouter } from "../routers/_app";
import { createQueuedashHtml } from "./utils";

export function queuedash({
  baseUrl,
  ctx,
}: {
  ctx: Context;
  baseUrl: string;
}): Elysia {
  return new Elysia({
    name: "queuedash",
  })
    .use(
      // @ts-expect-error
      trpc(appRouter, {
        endpoint: `${baseUrl}/trpc`,
        createContext: (params) => {
          return { ...params, ...ctx };
        },
      }),
    )
    .get(
      baseUrl,
      async () =>
        new Response(createQueuedashHtml(baseUrl), {
          headers: { "Content-Type": "text/html; charset=utf8" },
        }),
    );
}
