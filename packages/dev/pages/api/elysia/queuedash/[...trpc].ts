import type { NextApiRequest, NextApiResponse } from "next";
import type { Elysia } from "elysia";

let elysiaApp: Elysia | null = null;
let elysiaError: Error | null = null;

async function getElysiaApp() {
  if (elysiaError) throw elysiaError;
  if (elysiaApp) return elysiaApp;

  try {
    const { Elysia } = await import("elysia");
    const { fetchRequestHandler } = await import(
      "@trpc/server/adapters/fetch"
    );
    const { appRouter } = await import("@queuedash/api");
    const { queues } = await import("../../../../utils/fake-data");

    elysiaApp = new Elysia({ name: "queuedash" }).all(
      "/*",
      async ({ request }) => {
        return fetchRequestHandler({
          endpoint: "/api/elysia/queuedash",
          router: appRouter,
          req: request,
          createContext: () => ({ queues }),
        });
      }
    );

    return elysiaApp;
  } catch (error) {
    elysiaError = error as Error;
    throw error;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const app = await getElysiaApp();

    const { trpc } = req.query;
    const endpoint = Array.isArray(trpc) ? trpc.join("/") : trpc || "";

    const queryParams = new URLSearchParams();
    Object.entries(req.query).forEach(([key, value]) => {
      if (key !== "trpc" && value) {
        queryParams.append(key, Array.isArray(value) ? value[0] : value);
      }
    });
    const queryString = queryParams.toString();

    const url = `http://localhost/api/elysia/queuedash/${endpoint}${
      queryString ? `?${queryString}` : ""
    }`;

    const headers: Record<string, string> = {};
    Object.entries(req.headers).forEach(([key, value]) => {
      if (value) {
        headers[key] = Array.isArray(value) ? value[0] : value;
      }
    });

    const webRequest = new Request(url, {
      method: req.method,
      headers: new Headers(headers),
      body:
        req.method !== "GET" && req.method !== "HEAD"
          ? JSON.stringify(req.body)
          : undefined,
    });

    const webResponse = await app.handle(webRequest);

    res.status(webResponse.status);
    webResponse.headers.forEach((value: string, key: string) => {
      res.setHeader(key, value);
    });
    const body = await webResponse.text();
    res.send(body);
  } catch (error) {
    res.status(500).json({
      error: "Elysia adapter failed",
      message: error instanceof Error ? error.message : "Unknown error",
      note: "Elysia requires Bun runtime and may not work in Next.js API routes (Node.js)",
    });
  }
}
