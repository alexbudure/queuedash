import type { Handler } from "express";
import { version } from "../../package.json";
import type { Context } from "../trpc";
import { appRouter } from "../routers/_app";
import * as trpcExpress from "@trpc/server/adapters/express";

export function createQueueDashExpressMiddleware({
  ctx,
}: {
  ctx: Context;
}): Handler {
  return (req, res, next) => {
    if (req.path === `${req.baseUrl}/trpc`) {
      return trpcExpress.createExpressMiddleware({
        router: appRouter,
        createContext: () => ctx,
      })(req, res, next);
    } else if (req.path === req.baseUrl) {
      return res.send(/* HTML */ `<!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta
              name="viewport"
              content="width=device-width, initial-scale=1.0"
            />
            <title>QueueDash App</title>
          </head>
          <body>
            <div id="root"></div>
            <script>
              window.__INITIAL_STATE__ = {
                apiUrl: "${req.baseUrl}/trpc",
                basename: "${req.baseUrl}",
              };
            </script>
            <link
              rel="stylesheet"
              href="https://unpkg.com/@queuedash/ui@${version}/dist/styles.css"
            />
            <script
              type="module"
              src="https://unpkg.com/@queuedash/client@${version}/dist/main.mjs"
            ></script>
          </body>
        </html>`);
    }
  };
}
