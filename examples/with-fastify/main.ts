import fastify from "fastify";
import Bull from "bull";
import { createQueueDashFastifyMiddleware } from "@queuedash/api";

const server = fastify();

createQueueDashFastifyMiddleware({
  server,
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

server.listen(3000, () => {
  console.log("Listening on port 3000");
});
