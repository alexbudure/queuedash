import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "@queuedash/api";
import { Hono } from "hono";

import { queues } from "../../../../../utils/fake-data";

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
    }),
  );

  return honoApp;
}

const handler = (req: Request) => {
  const app = getHonoApp();
  return app.fetch(req);
};

export { handler as GET, handler as POST };
