import { appRouter } from "@queuedash/api";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { queues } from "../../../../../utils/fake-data";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc/queuedash",
    router: appRouter,
    req,
    createContext: () => ({
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
            deny: ["queue.empty", "job.remove"] as const,
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
    }),
  });

export { handler as GET, handler as POST };
