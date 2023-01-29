import * as trpcNext from "@trpc/server/adapters/next";
import { appRouter } from "@queuedash/api";
import type { QueueOptions } from "bull";
import Redis from "ioredis";

type SyncJob = {
  name: string;
};

const redisUrl = process.env.REDIS_URL as string;

const createRedisClient = () => {
  return new Redis(redisUrl, {
    tls: {},
    connectTimeout: 30000,
  });
};
const client = createRedisClient();
const subscriber = createRedisClient();
const opts = {
  createClient(type) {
    switch (type) {
      case "client":
        return client;
      case "subscriber":
        return subscriber;
      default:
        return createRedisClient();
    }
  },
} satisfies QueueOptions;

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
    opts,
    queues: [
      {
        name: "report-queue",
        displayName: "Report Queue",
      },
      {
        name: "notifications-daily-queue",
        displayName: "Notifications Daily Queue",
      },
      {
        name: "sync-queue",
        displayName: "Sync Queue",
        jobName(data) {
          return (data as SyncJob).name;
        },
      },
    ],
  }),
});
