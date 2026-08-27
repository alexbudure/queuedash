import * as trpcNodeHttp from "@trpc/server/adapters/node-http";
import type { Handler } from "express";

import type { Context } from "../routers/_app";
import { appRouter } from "../routers/_app";
import {
  createQueuedashExpiredSessionCookie,
  createQueuedashSessionCookie,
  getQueuedashAuthMode,
  isQueuedashBasicAuthorized,
  isQueuedashSessionAuthorized,
  QUEUEDASH_AUTH_CHALLENGE,
  QUEUEDASH_AUTH_REQUIRED_MESSAGE,
  type QueuedashAuthOptions,
} from "./auth";
import { createQueuedashHtml } from "./utils";

export function createQueuedashExpressMiddleware({
  ctx,
  auth,
}: {
  ctx: Context;
  auth?: QueuedashAuthOptions;
}): Handler {
  return async (req, res) => {
    const authMode = getQueuedashAuthMode(auth);
    const sendUnauthorized = (challenge = false) => {
      res.set({
        "Cache-Control": "no-store",
        ...(challenge ? { "WWW-Authenticate": QUEUEDASH_AUTH_CHALLENGE } : {}),
      });
      res.status(401).send(QUEUEDASH_AUTH_REQUIRED_MESSAGE);
    };

    if (
      authMode === "basic" &&
      !isQueuedashBasicAuthorized(req.headers.authorization, auth)
    ) {
      sendUnauthorized(true);
      return;
    }

    if (authMode === "session" && auth) {
      if (req.path === "/auth/login" && req.method === "POST") {
        if (!isQueuedashBasicAuthorized(req.headers.authorization, auth)) {
          sendUnauthorized();
          return;
        }

        res
          .set({
            "Cache-Control": "no-store",
            "Set-Cookie": createQueuedashSessionCookie({
              auth,
              baseUrl: req.baseUrl,
              requestIsSecure: req.secure,
            }),
          })
          .status(204)
          .send();
        return;
      }

      if (req.path === "/auth/logout" && req.method === "POST") {
        res
          .set({
            "Cache-Control": "no-store",
            "Set-Cookie": createQueuedashExpiredSessionCookie(req.baseUrl),
          })
          .status(204)
          .send();
        return;
      }

      if (req.path === "/auth/session" && req.method === "GET") {
        if (!isQueuedashSessionAuthorized(req.headers.cookie, auth)) {
          sendUnauthorized();
          return;
        }

        res.set({ "Cache-Control": "no-store" }).status(204).send();
        return;
      }

      if (req.path.startsWith("/auth/")) {
        res.status(404).send("Not found");
        return;
      }
    }

    if (req.path.startsWith("/trpc")) {
      res.set("Cache-Control", "private, no-store");
      if (
        authMode === "session" &&
        !isQueuedashSessionAuthorized(req.headers.cookie, auth)
      ) {
        sendUnauthorized();
        return;
      }

      const endpoint = req.path.replace("/trpc", "").slice(1);
      await trpcNodeHttp.nodeHTTPRequestHandler({
        router: appRouter,
        createContext: () => ctx,
        req,
        res,
        path: endpoint,
      });
    } else {
      res
        .type("text/html")
        .send(
          createQueuedashHtml(
            req.baseUrl,
            ctx.ui,
            authMode === "session"
              ? { baseUrl: `${req.baseUrl}/auth` }
              : undefined,
          ),
        );
    }
  };
}

/** @deprecated Use createQueuedashExpressMiddleware instead. */
export const createQueueDashExpressMiddleware =
  createQueuedashExpressMiddleware;
