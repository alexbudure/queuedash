import { Hono } from "hono";

import type { Context } from "../routers/_app";
import type { QueuedashAuthOptions } from "./auth";
import { createQueuedashFetchHandler } from "./utils";

export const createHonoAdapter = ({
  baseUrl,
  ctx,
  auth,
}: {
  baseUrl: string;
  ctx: Context;
  auth?: QueuedashAuthOptions;
}) => {
  const handle = createQueuedashFetchHandler({ auth, baseUrl, ctx });

  return new Hono().all("*", (c) => handle(c.req.raw));
};
