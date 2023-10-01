import { Router } from "express";
import { html_app } from "./html";
import * as trpcExpress from "@trpc/server/adapters/express";
import { appRouter, Context } from "../routers/_app";

export function createQueueDashExpressMiddleware({
  ctx,
}: {
  ctx: Context;
}): Router {
  const router = Router();

  router.use(
    "/trpc",
    trpcExpress.createExpressMiddleware({
      router: appRouter,
      createContext: () => ctx,
    })
  );
  router.get("/", (req, res) => {
    res.send(html_app(req.baseUrl));
  });
  router.get("/*", (req, res) => {
    res.send(html_app(req.baseUrl));
  });

  return router;
}
