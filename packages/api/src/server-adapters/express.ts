import * as trpcNodeHttp from "@trpc/server/adapters/node-http";
import type { Handler } from "express";

import type { Context } from "../routers/_app";
import { appRouter } from "../routers/_app";
import {
  isQueueDashAuthorized,
  QUEUEDASH_AUTH_CHALLENGE,
  QUEUEDASH_AUTH_REQUIRED_MESSAGE,
  type QueueDashAuthOptions,
} from "./auth";
import { createQueuedashHtml } from "./utils";

export function createQueueDashExpressMiddleware({
  ctx,
  auth,
}: {
  ctx: Context;
  auth?: QueueDashAuthOptions;
}): Handler {
  return async (req, res, next) => {
    if (!isQueueDashAuthorized(req.headers.authorization, auth)) {
      res
        .set({
          "WWW-Authenticate": QUEUEDASH_AUTH_CHALLENGE,
          "Cache-Control": "no-store",
        })
        .status(401)
        .send(QUEUEDASH_AUTH_REQUIRED_MESSAGE);
      return;
    }

    if (req.path.startsWith("/trpc")) {
      const endpoint = req.path.replace("/trpc", "").slice(1);
      await trpcNodeHttp.nodeHTTPRequestHandler({
        router: appRouter,
        createContext: () => ctx,
        req,
        res,
        path: endpoint,
      });
    } else {
      res.type("text/html").send(createQueuedashHtml(req.baseUrl));
      next();
    }
  };
}
