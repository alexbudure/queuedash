import { appRouter, type QueuedashAction } from "@queuedash/api";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { queues } from "../../../../../utils/fake-data";

// Queuedash caches its queue registry per context object, so every request
// shares this one; a context built per request would rebuild all adapters.
const ctx = {
  queues,
  access: {
    default: "full" as const,
    rules: [
      {
        queues: ["payment-processing"],
        mode: "read-only" as const,
      },
      {
        queues: ["session-cleanup"],
        mode: "hidden" as const,
      },
      {
        queues: ["email-delivery"],
        deny: ["queue.empty", "job.remove"] satisfies QueuedashAction[],
      },
    ],
  },
  privacy: {
    redact: true,
    expose: {
      stacktraces: false,
    },
  },
  search: {
    maxScanned: 750,
  },
};

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc/queuedash",
    router: appRouter,
    req,
    createContext: () => ctx,
  });

export { handler as GET, handler as POST };
