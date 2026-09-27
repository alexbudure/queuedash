import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { version } from "../../package.json";
import { appRouter } from "../routers/_app";
import type { Context, QueuedashUiConfig } from "../trpc";
import {
  getQueuedashRoute,
  type QueuedashAuthOptions,
  type QueuedashPublicAuthConfig,
  resolveQueuedashRequest,
  validateQueuedashAuthOptions,
} from "./auth";
import { QUEUEDASH_FAVICON } from "./favicon";

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
        <style>
          html,
          body {
            margin: 0;
            min-height: 100%;
          }
          #root {
            min-height: 100vh;
          }
        </style>
        <link
          rel="icon"
          href="${escapeHtml(
            ui?.branding?.faviconUrl?.trim() || QUEUEDASH_FAVICON,
          )}"
        />
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

/** The pathname beneath `baseUrl`, or undefined when it lies outside it. */
const getPathBeneath = (
  pathname: string,
  baseUrl: string,
): string | undefined => {
  const base = baseUrl.replace(/\/+$/, "");
  if (pathname === base) return "/";
  return pathname.startsWith(`${base}/`)
    ? pathname.slice(base.length)
    : undefined;
};

/**
 * Serves the dashboard from Fetch API requests. The Hono and Elysia adapters
 * differ only in how they mount it.
 */
export const createQueuedashFetchHandler = ({
  auth,
  baseUrl,
  ctx,
}: {
  auth?: QueuedashAuthOptions;
  baseUrl: string;
  ctx: Context;
}): ((request: Request) => Promise<Response>) => {
  const authMode = validateQueuedashAuthOptions(auth);

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    // The raw pathname, which is also what tRPC resolves procedures from.
    const path = getPathBeneath(url.pathname, baseUrl);
    const decision = resolveQueuedashRequest(auth, {
      route:
        path === undefined
          ? "not-found"
          : getQueuedashRoute(request.method, path),
      method: request.method,
      authorization: request.headers.get("Authorization"),
      cookie: request.headers.get("Cookie"),
      contentType: request.headers.get("Content-Type"),
      baseUrl,
      isSecure: url.protocol === "https:",
    });

    if (decision.type === "respond") {
      return new Response(decision.body ?? null, {
        status: decision.status,
        headers: decision.headers,
      });
    }

    if (decision.type === "trpc") {
      const response = await fetchRequestHandler({
        endpoint: `${baseUrl}/trpc`,
        router: appRouter,
        req: request,
        // The same object on every request: the queue registry, and the Redis
        // connections discovery opens, are cached per context.
        createContext: () => ctx,
      });
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(decision.headers)) {
        headers.set(name, value);
      }
      return new Response(response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
    }

    return new Response(
      createQueuedashHtml(
        baseUrl,
        ctx.ui,
        authMode === "session" ? { baseUrl: `${baseUrl}/auth` } : undefined,
      ),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  };

  return async (request) => {
    const response = await handle(request);
    // Elysia sends a HEAD response's body as given.
    return request.method === "HEAD"
      ? new Response(null, {
          status: response.status,
          headers: response.headers,
        })
      : response;
  };
};
