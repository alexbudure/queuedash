import type { Express } from "express";
import { version } from "../../package.json";
import type { Context } from "../trpc";
import { appRouter } from "../routers/_app";
import * as trpcExpress from "@trpc/server/adapters/express";

export function createQueueDashExpressMiddleware({
  baseUrl,
  app,
  ctx,
}: {
  app: Pick<Express, "use">;
  ctx: Context;
  baseUrl: string;
}): void {
  app.use(
    `${baseUrl}/trpc`,
    trpcExpress.createExpressMiddleware({
      router: appRouter,
      createContext: () => ctx,
    })
  );
  app.use(baseUrl, (_, res) => {
    res.send(/* HTML */ `<!DOCTYPE html>
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
              apiUrl: "${baseUrl}/trpc",
              basename: "${baseUrl}",
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
  });
}
