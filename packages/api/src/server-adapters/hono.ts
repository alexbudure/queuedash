import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";

import { appRouter } from "../routers/_app";
import type { Context } from "../routers/_app";
import {
  createQueueDashUnauthorizedResponse,
  isQueueDashAuthorized,
  type QueueDashAuthOptions,
} from "./auth";
import { createQueuedashHtml } from "./utils";

export const createHonoAdapter = ({
  baseUrl,
  ctx,
  auth,
}: {
  baseUrl: string;
  ctx: Context;
  auth?: QueueDashAuthOptions;
}) => {
  return new Hono()
    .use("*", async (c, next) => {
      if (!isQueueDashAuthorized(c.req.header("Authorization"), auth)) {
        return createQueueDashUnauthorizedResponse();
      }

      await next();
    })
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
};
