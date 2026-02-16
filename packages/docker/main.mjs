import { z } from "zod";
import Bull from "bull";
import { Queue as BullMQQueue } from "bullmq";
import BeeQueue from "bee-queue";
import { Cluster } from "ioredis";
import express from "express";
import { createQueueDashExpressMiddleware } from "@queuedash/api";
import { readFileSync } from "node:fs";

const queueConfigSchema = z.object({
  queues: z.array(
    z
      .object({
        name: z.string(),
        displayName: z.string(),
        type: z.enum(["bull", "bullmq", "bee"]),
        connectionUrl: z.string().optional(),
        clusterNodes: z
          .array(z.object({ host: z.string(), port: z.number() }))
          .optional(),
      })
      .refine(
        (data) => data.connectionUrl || data.clusterNodes,
        "Either connectionUrl or clusterNodes must be provided",
      )
      .refine(
        (data) => !(data.connectionUrl && data.clusterNodes),
        "Cannot specify both connectionUrl and clusterNodes",
      ),
  ),
});

const getConfigJson = () => {
  if (process.env.QUEUES_CONFIG_JSON) {
    return process.env.QUEUES_CONFIG_JSON;
  }

  if (process.env.QUEUES_CONFIG_FILE_PATH) {
    return readFileSync(process.env.QUEUES_CONFIG_FILE_PATH, "utf-8");
  }

  throw new Error(
    "Either QUEUES_CONFIG_JSON or QUEUES_CONFIG_FILE_PATH environment variables must be set",
  );
};

const getQueuesFromConfig = () => {
  const config = queueConfigSchema.parse(JSON.parse(getConfigJson()));

  return config.queues.map((queueConfig) => {
    if (queueConfig.clusterNodes) {
      if (queueConfig.type !== "bullmq") {
        throw new Error(
          `Cluster mode is only supported for bullmq queues, but queue "${queueConfig.name}" has type "${queueConfig.type}"`,
        );
      }

      const queue = new BullMQQueue(queueConfig.name, {
        connection: new Cluster(queueConfig.clusterNodes),
      });
      return {
        queue,
        displayName: queueConfig.displayName,
        type: "bullmq",
      };
    }

    if (!queueConfig.connectionUrl) {
      throw new Error(
        `Queue "${queueConfig.name}" is missing connectionUrl and clusterNodes`,
      );
    }

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
