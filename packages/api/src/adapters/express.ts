import type { Handler } from "express";
import { version } from "../../package.json";

export function createExpressMiddleware({
  apiUrl,
}: {
  apiUrl: string;
}): Handler {
  return async (req, res) => {
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
              apiUrl: "${apiUrl}",
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
  };
}
