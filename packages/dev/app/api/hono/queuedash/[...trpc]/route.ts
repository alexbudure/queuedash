import { appRouter } from "@queuedash/api";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";

import { queues } from "../../../../../utils/fake-data";

// Queuedash caches its queue registry per context object, so every request
// shares this one; a context built per request would rebuild all adapters.
// @hono/trpc-server's middleware copies the context into a new object on
// every request, so the route calls tRPC's fetch adapter itself.
const ctx = { queues };

let honoApp: Hono | null = null;

function getHonoApp() {
  if (honoApp) return honoApp;

  honoApp = new Hono();
  honoApp.all("/*", (c) =>
    fetchRequestHandler({
      endpoint: "/api/hono/queuedash",
      router: appRouter,
      req: c.req.raw,
      createContext: () => ctx,
    }),
  );

  return honoApp;
}

const handler = (req: Request) => {
  const app = getHonoApp();
  return app.fetch(req);
};

export { handler as GET, handler as POST };
