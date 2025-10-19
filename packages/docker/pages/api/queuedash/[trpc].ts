import * as trpcNext from "@trpc/server/adapters/next";
import { appRouter } from "@queuedash/api";
import { z } from "zod";
import Bull from "bull";
import { Queue as BullMQQueue } from "bullmq";
import BeeQueue from "bee-queue";

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
    if (queueConfig.type === "bullmq") {
      const queue = new BullMQQueue(queueConfig.name, {
        connection: {
          url: queueConfig.connectionUrl,
        },
      });
      return {
        queue,
        displayName: queueConfig.displayName,
        type: "bullmq" as const,
      };
    } else if (queueConfig.type === "bull") {
      const queue = new Bull(queueConfig.name, queueConfig.connectionUrl);
      return {
        queue,
        displayName: queueConfig.displayName,
        type: "bull" as const,
      };
    } else {
      const queue = new BeeQueue(queueConfig.name, {
        redis: queueConfig.connectionUrl,
      });
      return {
        queue,
        displayName: queueConfig.displayName,
        type: "bee" as const,
      };
    }
  });
};

export default trpcNext.createNextApiHandler({
  router: appRouter,
  onError({ error }) {
    if (error.code === "INTERNAL_SERVER_ERROR") {
      // send to bug reporting
      console.error("Something went wrong", error);
    }
  },
  batching: {
    enabled: true,
  },
  createContext: () => ({
    queues: getQueuesFromConfig(),
  }),
});
