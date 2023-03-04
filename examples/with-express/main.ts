import express from "express";
import Bull from "bull";
import { createQueueDashExpressMiddleware } from "@queuedash/api";

const app = express();

createQueueDashExpressMiddleware({
  app,
  baseUrl: "/queuedash",
  ctx: {
    queues: [
      {
        queue: new Bull("report-queue"),
        displayName: "Reports",
        type: "bull",
      },
    ],
  },
});

app.listen(3000, () => {
  console.log("Listening on port 3000");
});
