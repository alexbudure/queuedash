import * as trpcNext from "@trpc/server/adapters/next";
import { queueDashRouter } from "@queuedash/api";
import { queues } from "../../../utils/fake-data";

export default trpcNext.createNextApiHandler({
  router: queueDashRouter,
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
    queues: queues.map((queue) => {
      return {
        queue: queue.queue,
        displayName: queue.displayName,
        type: queue.type,
        jobName: queue.jobName,
      };
    }),
  }),
});
