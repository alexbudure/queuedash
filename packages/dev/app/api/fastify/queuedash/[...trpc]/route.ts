import { appRouter } from "@queuedash/api";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { queues } from "../../../../../utils/fake-data";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/fastify/queuedash",
    router: appRouter,
    req,
    createContext: () => ({ queues }),
  });

export { handler as GET, handler as POST };
