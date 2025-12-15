import type { NextApiRequest, NextApiResponse } from "next";
import * as trpcNodeHttp from "@trpc/server/adapters/node-http";
import { appRouter } from "@queuedash/api";
import { queues } from "../../../../utils/fake-data";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { trpc } = req.query;
  const endpoint = Array.isArray(trpc) ? trpc.join("/") : trpc || "";

  await trpcNodeHttp.nodeHTTPRequestHandler({
    router: appRouter,
    createContext: () => ({ queues }),
    req,
    res,
    path: endpoint,
  });
}
