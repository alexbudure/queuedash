import { appRouter } from "@queuedash/api";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { queues } from "../../../../../utils/fake-data";

// Queuedash caches its queue registry per context object, so every request
// shares this one; a context built per request would rebuild all adapters.
const ctx = { queues };

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/express/queuedash",
    router: appRouter,
    req,
    createContext: () => ctx,
  });

export { handler as GET, handler as POST };
