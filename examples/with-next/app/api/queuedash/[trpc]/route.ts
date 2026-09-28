import { appRouter, rejectNonJsonPost } from "@queuedash/api";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import Bull from "bull";

const reportsQueue = new Bull("report-queue");
const ctx = {
  queues: [
    {
      queue: reportsQueue,
      displayName: "Reports",
      type: "bull" as const,
    },
  ],
};

const handler = async (req: Request) => {
  // tRPC would also run a mutation posted by a plain form on another website.
  const rejected = rejectNonJsonPost(req);
  if (rejected) return rejected;

  const response = await fetchRequestHandler({
    endpoint: "/api/queuedash",
    req,
    router: appRouter,
    createContext: () => ctx,
    onError({ error }) {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        console.error("Something went wrong", error);
      }
    },
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
};

export { handler as GET, handler as POST };
