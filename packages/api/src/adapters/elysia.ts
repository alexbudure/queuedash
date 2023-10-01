import { Elysia } from "elysia";
import { trpc } from "@elysiajs/trpc";
import type { Context } from "../trpc";
import { appRouter } from "src/main";
import { html_app } from "./html";

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
      trpc(appRouter, {
        endpoint: `${baseUrl}/trpc`,
        createContext: (params) => {
          return { ...params, ...ctx };
        },
      })
    )
    .get(
      baseUrl,
      async () =>
        new Response(html_app(baseUrl), {
          headers: { "Content-Type": "text/html; charset=utf8" },
        })
    );
}
