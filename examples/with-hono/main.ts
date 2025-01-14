import { serve } from "@hono/node-server";
import { Hono } from "hono";
import Bull from "bull";
import { createHonoAdapter } from "@queuedash/api";

const app = new Hono();

app.route(
  "/queuedash",
  createHonoAdapter({
    baseUrl: "/queuedash",
    ctx: {
      queues: [
        {
          queue: new Bull("report-queue"),
          displayName: "Reports",
          type: "bull" as const,
        },
      ],
    },
  })
);

const port = 3000;
console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
