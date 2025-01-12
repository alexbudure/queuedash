import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "../routers/_app";
import type { Context } from "../routers/_app";
import { createQueuedashHtml } from "./utils";

export const createHonoAdapter = ({
  baseUrl,
  ctx,
}: {
  baseUrl: string;
  ctx: Context;
}) =>
  new Hono()
    .use(
      "/trpc/*",
      trpcServer({
        endpoint: `${baseUrl}/trpc`,
        router: appRouter,
        createContext: () => ctx,
      }),
    )
    .get("*", (c) => {
      return c.html(createQueuedashHtml(baseUrl));
    });
