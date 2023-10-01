import type { Handler } from "express";
import { appRouter, Context } from "../routers/_app";
import * as trpcNodeHttp from "@trpc/server/adapters/node-http";
import { createQueuedashHtml } from "./utils";

export function createQueueDashExpressMiddleware({
  ctx,
}: {
  ctx: Context;
}): Handler {
  return async (req, res, next) => {
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
