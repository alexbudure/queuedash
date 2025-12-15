import { Elysia } from "elysia";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
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
    .all(`${baseUrl}/trpc/*`, async ({ request }) => {
      return fetchRequestHandler({
        endpoint: `${baseUrl}/trpc`,
        router: appRouter,
        req: request,
        createContext: () => ctx,
      });
    })
    .get(
      baseUrl,
      async () =>
        new Response(createQueuedashHtml(baseUrl), {
          headers: { "Content-Type": "text/html; charset=utf8" },
        }),
    );
}
