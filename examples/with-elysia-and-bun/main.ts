import Bull from "bull";
import { Elysia } from "elysia";
import { createQueueDashElysiaMiddleware } from "@queuedash/api";

const app = new Elysia();

createQueueDashElysiaMiddleware({
  app,
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
});

await app.listen(3000);
console.log(`Running at http://${app.server?.hostname}:${app.server?.port}`);
