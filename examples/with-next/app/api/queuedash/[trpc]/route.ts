import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@queuedash/api";
import Bull from "bull";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/queuedash",
    req,
    router: appRouter,
    createContext: () => ({
      queues: [
        {
          queue: new Bull("report-queue"),
          displayName: "Reports",
          type: "bull" as const,
        },
      ],
    }),
    onError({ error }) {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        console.error("Something went wrong", error);
      }
    },
  });

export { handler as GET, handler as POST };
