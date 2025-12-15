import type { NextApiRequest, NextApiResponse } from "next";
import Fastify, { type FastifyInstance } from "fastify";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "@queuedash/api";
import { queues } from "../../../../utils/fake-data";

let fastifyInstance: FastifyInstance | null = null;

async function getFastifyInstance() {
  if (fastifyInstance) return fastifyInstance;

  fastifyInstance = Fastify({ logger: false });

  await fastifyInstance.register(fastifyTRPCPlugin, {
    prefix: "",
    trpcOptions: {
      router: appRouter,
      createContext: () => ({ queues }),
    },
  });

  await fastifyInstance.ready();
  return fastifyInstance;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const fastify = await getFastifyInstance();

  const { trpc } = req.query;
  const endpoint = Array.isArray(trpc) ? trpc.join("/") : trpc || "";

  const queryParams = new URLSearchParams();
  Object.entries(req.query).forEach(([key, value]) => {
    if (key !== "trpc" && value) {
      queryParams.append(key, Array.isArray(value) ? value[0] : value);
    }
  });
  const queryString = queryParams.toString();

  const response = await fastify.inject({
    method: req.method as "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
    url: `/${endpoint}${queryString ? `?${queryString}` : ""}`,
    headers: req.headers as Record<string, string>,
    payload: req.body ? JSON.stringify(req.body) : undefined,
  });

  res.status(response.statusCode);
  Object.entries(response.headers).forEach(([key, value]) => {
    if (value) res.setHeader(key, value as string);
  });
  res.send(response.body);
}
