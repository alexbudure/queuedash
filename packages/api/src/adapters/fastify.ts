import type { FastifyInstance } from "fastify";
import type { Context } from "../trpc";
import { appRouter } from "../routers/_app";
import * as trpcFastify from "@trpc/server/adapters/fastify";
import { createQueuedashHtml } from "./utils";

export function fastifyQueueDashPlugin(
  fastify: FastifyInstance,
  {
    baseUrl,
    ctx,
  }: {
    ctx: Context;
    baseUrl: string;
  },
  done: () => void
): void {
  fastify.get(`${baseUrl}/*`, (_, res) => {
    res.type("text/html").send(createQueuedashHtml(baseUrl));
  });
  fastify.get(baseUrl, (_, res) => {
    res.type("text/html").send(createQueuedashHtml(baseUrl));
  });
  fastify.register(trpcFastify.fastifyTRPCPlugin, {
    prefix: `${baseUrl}/trpc`,
    trpcOptions: { router: appRouter, createContext: () => ctx },
  });

  done();
}
