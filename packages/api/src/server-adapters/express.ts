import * as trpcNodeHttp from "@trpc/server/adapters/node-http";
import type { Handler } from "express";

import type { Context } from "../routers/_app";
import { appRouter } from "../routers/_app";
import {
  getQueuedashRoute,
  type QueuedashAuthOptions,
  resolveQueuedashRequest,
  validateQueuedashAuthOptions,
} from "./auth";
import { createQueuedashHtml } from "./utils";

export function createQueuedashExpressMiddleware({
  ctx,
  auth,
}: {
  ctx: Context;
  auth?: QueuedashAuthOptions;
}): Handler {
  const authMode = validateQueuedashAuthOptions(auth);

  return async (req, res, next) => {
    // Express 4 does not catch a rejected handler: an error escaping here
    // would be an unhandled rejection, which ends the host process.
    try {
      const decision = resolveQueuedashRequest(auth, {
        route: getQueuedashRoute(req.method, req.path),
        method: req.method,
        authorization: req.headers.authorization,
        cookie: req.headers.cookie,
        contentType: req.headers["content-type"],
        baseUrl: req.baseUrl,
        isSecure: req.secure,
      });

      if (decision.type === "respond") {
        res.set(decision.headers).status(decision.status).send(decision.body);
        return;
      }

      if (decision.type === "trpc") {
        res.set(decision.headers);
        const endpoint = req.path.replace("/trpc", "").slice(1);
        await trpcNodeHttp.nodeHTTPRequestHandler({
          router: appRouter,
          createContext: () => ctx,
          req,
          res,
          path: endpoint,
        });
        return;
      }

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
    } catch (error) {
      next(error);
    }
  };
}

/** @deprecated Use createQueuedashExpressMiddleware instead. */
export const createQueueDashExpressMiddleware =
  createQueuedashExpressMiddleware;
