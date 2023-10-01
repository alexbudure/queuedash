import { Elysia } from "elysia";
import { trpc } from "@elysiajs/trpc";
import type { Context } from "../trpc";
import { appRouter } from "src/main";
import { version } from "../../package.json";

const html_app = (baseUrl: string) => /* HTML */ `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
  </html>`;

export function queuedash({
  baseUrl,
  ctx,
}: {
  ctx: Context;
  baseUrl: string;
}): Elysia {
  return new Elysia({
    name: "queuedash",
  })
    .use(
      trpc(appRouter, {
        endpoint: `${baseUrl}/trpc`,
        createContext: (params) => {
          return { ...params, ...ctx };
        },
      })
    )
    .get(
      baseUrl,
      async () =>
        new Response(html_app(baseUrl), {
          headers: { "Content-Type": "text/html; charset=utf8" },
        })
    );
}
