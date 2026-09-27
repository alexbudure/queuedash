import { Elysia } from "elysia";

import { closeQueuedashContext } from "../queue-registry";
import type { Context } from "../routers/_app";
import type { QueuedashAuthOptions } from "./auth";
import { createQueuedashFetchHandler } from "./utils";

export function queuedash({
  baseUrl,
  ctx,
  auth,
}: {
  ctx: Context;
  baseUrl: string;
  auth?: QueuedashAuthOptions;
}): Elysia {
  const handle = createQueuedashFetchHandler({ auth, baseUrl, ctx });

  return new Elysia({
    name: "queuedash",
  })
    .onStop(async () => {
      await closeQueuedashContext(ctx);
    })
    .all(baseUrl, ({ request }) => handle(request))
    .all(`${baseUrl}/*`, ({ request }) => handle(request));
}
