import { createQueuedashExpressMiddleware } from "@queuedash/api";
import Bull from "bull";
import express from "express";

const app = express();

app.use(
  "/queuedash",
  createQueuedashExpressMiddleware({
    ctx: {
      queues: [
        {
          queue: new Bull("report-queue"),
          displayName: "Reports",
          type: "bull" as const,
        },
      ],
    },
  }),
);

app.listen(3000, () => {
  console.log("Listening on port 3000");
  console.log("Visit http://localhost:3000/queuedash");
});
