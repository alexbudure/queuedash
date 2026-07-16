import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Elysia } from "elysia";

import type { Context } from "../routers/_app";
import { appRouter } from "../routers/_app";
import {
  createQueueDashUnauthorizedResponse,
  isQueueDashAuthorized,
  type QueueDashAuthOptions,
} from "./auth";
import { createQueuedashHtml } from "./utils";

export function queuedash({
  baseUrl,
  ctx,
  auth,
}: {
  ctx: Context;
  baseUrl: string;
  auth?: QueueDashAuthOptions;
}): Elysia {
  return new Elysia({
    name: "queuedash",
  })
    .all(`${baseUrl}/trpc/*`, async ({ request }) => {
      if (!isQueueDashAuthorized(request.headers.get("Authorization"), auth)) {
        return createQueueDashUnauthorizedResponse();
      }

      return fetchRequestHandler({
        endpoint: `${baseUrl}/trpc`,
        router: appRouter,
        req: request,
        createContext: () => ctx,
      });
    })
    .get(baseUrl, async ({ request }) => {
      if (!isQueueDashAuthorized(request.headers.get("Authorization"), auth)) {
        return createQueueDashUnauthorizedResponse();
      }

      return new Response(createQueuedashHtml(baseUrl), {
        headers: { "Content-Type": "text/html; charset=utf8" },
      });
    });
}
