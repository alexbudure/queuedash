import * as trpcNext from "@trpc/server/adapters/next";
import { appRouter } from "@queuedash/api";
import { queues } from "../../../../utils/fake-data";

export default trpcNext.createNextApiHandler({
  router: appRouter,
  onError({ error }) {
    if (error.code === "INTERNAL_SERVER_ERROR") {
      console.error("Something went wrong", error);
    }
  },
  batching: {
    enabled: true,
  },
  createContext: () => ({
    queues,
  }),
});
