import type { NextApiRequest, NextApiResponse } from "next";
import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "@queuedash/api";
import { queues } from "../../../../utils/fake-data";

let honoApp: Hono | null = null;

function getHonoApp() {
  if (honoApp) return honoApp;

  honoApp = new Hono();
  honoApp.use(
    "/*",
    trpcServer({
      endpoint: "/api/hono/queuedash",
      router: appRouter,
      createContext: () => ({ queues }),
    })
  );

  return honoApp;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const app = getHonoApp();

  const { trpc } = req.query;
  const endpoint = Array.isArray(trpc) ? trpc.join("/") : trpc || "";

  const queryParams = new URLSearchParams();
  Object.entries(req.query).forEach(([key, value]) => {
    if (key !== "trpc" && value) {
      queryParams.append(key, Array.isArray(value) ? value[0] : value);
    }
  });
  const queryString = queryParams.toString();

  const url = `http://localhost/api/hono/queuedash/${endpoint}${
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

  const webResponse = await app.fetch(webRequest);

  res.status(webResponse.status);
  webResponse.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const body = await webResponse.text();
  res.send(body);
}
