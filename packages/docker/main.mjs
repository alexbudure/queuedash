import { z } from "zod";
import Bull from "bull";
import { Queue as BullMQQueue } from "bullmq";
import BeeQueue from "bee-queue";
import express from "express";
import { createQueueDashExpressMiddleware } from "@queuedash/api";

const queueConfigSchema = z.object({
  queues: z.array(
    z.object({
      name: z.string(),
      displayName: z.string(),
      type: z.enum(["bull", "bullmq", "bee"]),
      connectionUrl: z.string(),
    }),
  ),
});

const getQueuesFromConfig = () => {
  const configJson = process.env.QUEUES_CONFIG_JSON;

  if (!configJson) {
    throw new Error("QUEUES_CONFIG_JSON environment variable is not set");
  }

  const config = queueConfigSchema.parse(JSON.parse(configJson));

  return config.queues.map((queueConfig) => {
    // Check if connection URL uses TLS (rediss://)
    const usesTls = queueConfig.connectionUrl.startsWith("rediss://");

    if (queueConfig.type === "bullmq") {
      const queue = new BullMQQueue(queueConfig.name, {
        connection: {
          url: queueConfig.connectionUrl,
          ...(usesTls && { tls: {} }),
        },
      });
      return {
        queue,
        displayName: queueConfig.displayName,
        type: "bullmq",
      };
    } else if (queueConfig.type === "bull") {
      const queue = new Bull(queueConfig.name, queueConfig.connectionUrl, {
        redis: {
          ...(usesTls && { tls: {} }),
        },
      });
      return {
        queue,
        displayName: queueConfig.displayName,
        type: "bull",
      };
    } else {
      const queue = new BeeQueue(queueConfig.name, {
        redis: queueConfig.connectionUrl,
        ...(usesTls && { tls: {} }),
      });
      return {
        queue,
        displayName: queueConfig.displayName,
        type: "bee",
      };
    }
  });
};

const app = express();

app.use(
  "/",
  createQueueDashExpressMiddleware({
    ctx: {
      queues: getQueuesFromConfig(),
    },
  }),
);

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`🚀 Server listening on http://${HOST}:${PORT}`);
});
