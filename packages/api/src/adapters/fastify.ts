import type { FastifyInstance } from "fastify";
import type { Context } from "../trpc";
import { appRouter } from "../routers/_app";
import * as trpcFastify from "@trpc/server/adapters/fastify";
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

export function fastifyQueueDashPlugin(
  fastify: FastifyInstance,
  {
    baseUrl,
    ctx,
  }: {
    ctx: Context;
    baseUrl: string;
  },
  done: () => void
): void {
  fastify.get(`${baseUrl}/*`, (_, res) => {
    res.type("text/html").send(html_app(baseUrl));
  });
  fastify.get(baseUrl, (_, res) => {
    res.type("text/html").send(html_app(baseUrl));
  });
  fastify.register(trpcFastify.fastifyTRPCPlugin, {
    prefix: `${baseUrl}/trpc`,
    trpcOptions: { router: appRouter, createContext: () => ctx },
  });

  done();
}
