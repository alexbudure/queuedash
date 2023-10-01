import { FastifyInstance } from "fastify";
import type { Context } from "../trpc";
import { appRouter } from "../routers/_app";
import * as trpcFastify from "@trpc/server/adapters/fastify";
import { html_app } from "./html";

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
    res.type("text/html").send(html_app(baseUrl));
  });
  fastify.get(baseUrl, (_, res) => {
    res.type("text/html").send(html_app(baseUrl));
  });
  fastify.register(trpcFastify.fastifyTRPCPlugin, {
    prefix: `${baseUrl}/trpc`,
    trpcOptions: { router: appRouter, createContext: () => ctx },
  });

  done();
}
