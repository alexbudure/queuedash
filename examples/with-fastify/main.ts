import { fastifyQueueDashPlugin } from "@queuedash/api";
import Bull from "bull";
import fastify from "fastify";

const server = fastify();

server.register(fastifyQueueDashPlugin, {
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

server.listen({ port: 3000 }, () => {
  console.log("Listening on port 3000");
  console.log("Visit http://localhost:3000/queuedash");
});
