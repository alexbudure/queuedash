import * as trpcNext from "@trpc/server/adapters/next";
import { appRouter } from "@queuedash/api";
import Bull from "bull";

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
    queues: [
      {
        queue: new Bull("report-queue"),
        displayName: "Reports",
        type: "bull" as const,
      },
    ],
  }),
});
