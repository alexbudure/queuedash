import type {
  FastifyInstance,
  onRequestHookHandler,
  preHandlerHookHandler,
} from "fastify";
import type { Context } from "../trpc";
import { appRouter } from "../routers/_app";
import * as trpcFastify from "@trpc/server/adapters/fastify";
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
  }: {
    ctx: Context;
    baseUrl: string;
    uiHooks?: FastifyQueueDashHooksOptions;
  },
  done: () => void
): void {
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
