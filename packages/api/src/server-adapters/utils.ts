import { version } from "../../package.json";
import type { QueuedashUiConfig } from "../trpc";
import type { QueuedashPublicAuthConfig } from "./auth";

const DEFAULT_PRODUCT_NAME = "Queuedash";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const serializeInitialState = (value: unknown): string =>
  JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");

export const createQueuedashHtml = (
  baseUrl: string,
  ui?: QueuedashUiConfig,
  auth?: QueuedashPublicAuthConfig,
) => /* HTML */ `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(
          ui?.branding?.name?.trim() || DEFAULT_PRODUCT_NAME,
        )}</title>
      </head>
      <body>
        <div id="root"></div>
        <script>
          window.__INITIAL_STATE__ = ${serializeInitialState({
            apiUrl: `${baseUrl}/trpc`,
            auth,
            basename: baseUrl,
            ui,
          })};
        </script>
        <link
          data-queuedash-styles
          rel="stylesheet"
          href="https://unpkg.com/@queuedash/ui@${version}/dist/styles.css"
        />
        <script
          type="module"
          src="https://unpkg.com/@queuedash/client@${version}/dist/main.mjs"
        ></script>
      </body>
    </html>`;
