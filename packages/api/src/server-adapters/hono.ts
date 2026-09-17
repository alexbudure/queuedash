import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";

import { appRouter } from "../routers/_app";
import type { Context } from "../routers/_app";
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

export const createHonoAdapter = ({
  baseUrl,
  ctx,
  auth,
}: {
  baseUrl: string;
  ctx: Context;
  auth?: QueuedashAuthOptions;
}) => {
  const authMode = getQueuedashAuthMode(auth);

  return new Hono()
    .use("*", async (c, next) => {
      if (
        authMode === "basic" &&
        !isQueuedashBasicAuthorized(c.req.header("Authorization"), auth)
      ) {
        return createQueuedashUnauthorizedResponse({ challenge: true });
      }

      await next();
    })
    .get("/auth/session", (c) => {
      if (
        authMode !== "session" ||
        !isQueuedashSessionAuthorized(c.req.header("Cookie"), auth)
      ) {
        return createQueuedashUnauthorizedResponse();
      }

      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "no-store" },
      });
    })
    .post("/auth/login", (c) => {
      if (
        authMode !== "session" ||
        !auth ||
        !isQueuedashBasicAuthorized(c.req.header("Authorization"), auth)
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
            requestIsSecure: new URL(c.req.url).protocol === "https:",
          }),
        },
      });
    })
    .post("/auth/logout", () => {
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
    .use(
      "/trpc/*",
      async (c, next) => {
        c.header("Cache-Control", "private, no-store");
        if (
          authMode === "session" &&
          !isQueuedashSessionAuthorized(c.req.header("Cookie"), auth)
        ) {
          return createQueuedashUnauthorizedResponse();
        }

        await next();
      },
      trpcServer({
        endpoint: `${baseUrl}/trpc`,
        router: appRouter,
        createContext: () => ctx,
      }),
    )
    .get("*", (c) => {
      return c.html(
        createQueuedashHtml(
          baseUrl,
          ctx.ui,
          authMode === "session" ? { baseUrl: `${baseUrl}/auth` } : undefined,
        ),
      );
    });
};
