import * as trpcFastify from "@trpc/server/adapters/fastify";
import type {
  FastifyInstance,
  onRequestHookHandler,
  preHandlerHookHandler,
} from "fastify";

import { appRouter } from "../routers/_app";
import type { Context } from "../trpc";
import {
  isQueueDashAuthorized,
  QUEUEDASH_AUTH_CHALLENGE,
  QUEUEDASH_AUTH_REQUIRED_MESSAGE,
  type QueueDashAuthOptions,
} from "./auth";
import { createQueuedashHtml } from "./utils";

export type FastifyQueueDashHooksOptions = Partial<{
  onRequest?: onRequestHookHandler;
  preHandler?: preHandlerHookHandler;
}>;

export function fastifyQueueDashPlugin(
  fastify: FastifyInstance,
  {
    baseUrl,
    ctx,
    uiHooks,
    auth,
  }: {
    ctx: Context;
    baseUrl: string;
    uiHooks?: FastifyQueueDashHooksOptions;
    auth?: QueueDashAuthOptions;
  },
  done: () => void,
): void {
  if (auth) {
    fastify.addHook("onRequest", async (req, res) => {
      if (!isQueueDashAuthorized(req.headers.authorization, auth)) {
        await res
          .header("WWW-Authenticate", QUEUEDASH_AUTH_CHALLENGE)
          .header("Cache-Control", "no-store")
          .code(401)
          .send(QUEUEDASH_AUTH_REQUIRED_MESSAGE);
      }
    });
  }

  fastify.get(`${baseUrl}/*`, { ...uiHooks }, (_, res) => {
    res.type("text/html").send(createQueuedashHtml(baseUrl));
  });
  fastify.get(baseUrl, { ...uiHooks }, (_, res) => {
    res.type("text/html").send(createQueuedashHtml(baseUrl));
  });
  fastify.register(trpcFastify.fastifyTRPCPlugin, {
    prefix: `${baseUrl}/trpc`,
    trpcOptions: { router: appRouter, createContext: () => ctx },
  });

  done();
}
