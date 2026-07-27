import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Elysia } from "elysia";

import type { Context } from "../routers/_app";
import { appRouter } from "../routers/_app";
import {
  createQueuedashExpiredSessionCookie,
  createQueuedashSessionCookie,
  createQueuedashUnauthorizedResponse,
  getQueuedashAuthMode,
  isQueuedashBasicAuthorized,
  isQueuedashSessionAuthorized,
  type QueuedashAuthOptions,
} from "./auth";
import { createQueuedashHtml } from "./utils";

export function queuedash({
  baseUrl,
  ctx,
  auth,
}: {
  ctx: Context;
  baseUrl: string;
  auth?: QueuedashAuthOptions;
}): Elysia {
  const authMode = getQueuedashAuthMode(auth);
  const createHtmlResponse = (request: Request) => {
    if (
      authMode === "basic" &&
      !isQueuedashBasicAuthorized(request.headers.get("Authorization"), auth)
    ) {
      return createQueuedashUnauthorizedResponse({ challenge: true });
    }

    return new Response(
      createQueuedashHtml(
        baseUrl,
        ctx.ui,
        authMode === "session" ? { baseUrl: `${baseUrl}/auth` } : undefined,
      ),
      {
        headers: { "Content-Type": "text/html; charset=utf8" },
      },
    );
  };

  return new Elysia({
    name: "queuedash",
  })
    .get(`${baseUrl}/auth/session`, async ({ request }) => {
      if (
        authMode !== "session" ||
        !isQueuedashSessionAuthorized(request.headers.get("Cookie"), auth)
      ) {
        return createQueuedashUnauthorizedResponse();
      }

      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "no-store" },
      });
    })
    .post(`${baseUrl}/auth/login`, async ({ request }) => {
      if (
        authMode !== "session" ||
        !auth ||
        !isQueuedashBasicAuthorized(request.headers.get("Authorization"), auth)
      ) {
        return createQueuedashUnauthorizedResponse();
      }

      return new Response(null, {
        status: 204,
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": createQueuedashSessionCookie({
            auth,
            baseUrl,
            requestIsSecure: new URL(request.url).protocol === "https:",
          }),
        },
      });
    })
    .post(`${baseUrl}/auth/logout`, async () => {
      if (authMode !== "session") {
        return createQueuedashUnauthorizedResponse();
      }

      return new Response(null, {
        status: 204,
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": createQueuedashExpiredSessionCookie(baseUrl),
        },
      });
    })
    .all(`${baseUrl}/trpc/*`, async ({ request }) => {
      if (
        authMode === "basic" &&
        !isQueuedashBasicAuthorized(request.headers.get("Authorization"), auth)
      ) {
        return createQueuedashUnauthorizedResponse({ challenge: true });
      }
      if (
        authMode === "session" &&
        !isQueuedashSessionAuthorized(request.headers.get("Cookie"), auth)
      ) {
        return createQueuedashUnauthorizedResponse();
      }

      return fetchRequestHandler({
        endpoint: `${baseUrl}/trpc`,
        router: appRouter,
        req: request,
        createContext: () => ctx,
      });
    })
    .get(baseUrl, async ({ request }) => createHtmlResponse(request));
}
