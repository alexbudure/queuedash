import * as trpcFastify from "@trpc/server/adapters/fastify";
import type {
  FastifyInstance,
  onRequestHookHandler,
  preHandlerHookHandler,
} from "fastify";

import { appRouter } from "../routers/_app";
import type { Context } from "../trpc";
import {
  createQueuedashExpiredSessionCookie,
  createQueuedashSessionCookie,
  getQueuedashAuthMode,
  isQueuedashBasicAuthorized,
  isQueuedashSessionAuthorized,
  QUEUEDASH_AUTH_CHALLENGE,
  QUEUEDASH_AUTH_REQUIRED_MESSAGE,
  type QueuedashAuthOptions,
} from "./auth";
import { createQueuedashHtml } from "./utils";

export type FastifyQueuedashHooksOptions = Partial<{
  onRequest?: onRequestHookHandler;
  preHandler?: preHandlerHookHandler;
}>;

/** @deprecated Use FastifyQueuedashHooksOptions instead. */
export type FastifyQueueDashHooksOptions = FastifyQueuedashHooksOptions;

export function fastifyQueuedashPlugin(
  fastify: FastifyInstance,
  {
    baseUrl,
    ctx,
    uiHooks,
    auth,
  }: {
    ctx: Context;
    baseUrl: string;
    uiHooks?: FastifyQueuedashHooksOptions;
    auth?: QueuedashAuthOptions;
  },
  done: () => void,
): void {
  const authMode = getQueuedashAuthMode(auth);
  const sendUnauthorized = (
    res: Parameters<onRequestHookHandler>[1],
    challenge = false,
  ) => {
    res.header("Cache-Control", "no-store");
    if (challenge) {
      res.header("WWW-Authenticate", QUEUEDASH_AUTH_CHALLENGE);
    }
    return res.code(401).send(QUEUEDASH_AUTH_REQUIRED_MESSAGE);
  };

  if (authMode) {
    fastify.addHook("onRequest", async (req, res) => {
      if (
        authMode === "basic" &&
        !isQueuedashBasicAuthorized(req.headers.authorization, auth)
      ) {
        return sendUnauthorized(res, true);
      }

      if (
        authMode === "session" &&
        req.url.startsWith(`${baseUrl}/trpc`) &&
        !isQueuedashSessionAuthorized(req.headers.cookie, auth)
      ) {
        return sendUnauthorized(res);
      }
    });
  }

  if (authMode === "session" && auth) {
    fastify.get(`${baseUrl}/auth/session`, async (req, res) => {
      if (!isQueuedashSessionAuthorized(req.headers.cookie, auth)) {
        return sendUnauthorized(res);
      }

      return res.header("Cache-Control", "no-store").code(204).send();
    });
    fastify.post(`${baseUrl}/auth/login`, async (req, res) => {
      if (!isQueuedashBasicAuthorized(req.headers.authorization, auth)) {
        return sendUnauthorized(res);
      }

      return res
        .header("Cache-Control", "no-store")
        .header(
          "Set-Cookie",
          createQueuedashSessionCookie({
            auth,
            baseUrl,
            requestIsSecure: req.protocol === "https",
          }),
        )
        .code(204)
        .send();
    });
    fastify.post(`${baseUrl}/auth/logout`, async (_, res) => {
      return res
        .header("Cache-Control", "no-store")
        .header("Set-Cookie", createQueuedashExpiredSessionCookie(baseUrl))
        .code(204)
        .send();
    });
  }

  fastify.get(`${baseUrl}/*`, { ...uiHooks }, (_, res) => {
    res
      .type("text/html")
      .send(
        createQueuedashHtml(
          baseUrl,
          ctx.ui,
          authMode === "session" ? { baseUrl: `${baseUrl}/auth` } : undefined,
        ),
      );
  });
  fastify.get(baseUrl, { ...uiHooks }, (_, res) => {
    res
      .type("text/html")
      .send(
        createQueuedashHtml(
          baseUrl,
          ctx.ui,
          authMode === "session" ? { baseUrl: `${baseUrl}/auth` } : undefined,
        ),
      );
  });
  fastify.register(trpcFastify.fastifyTRPCPlugin, {
    prefix: `${baseUrl}/trpc`,
    trpcOptions: { router: appRouter, createContext: () => ctx },
  });

  done();
}

/** @deprecated Use fastifyQueuedashPlugin instead. */
export const fastifyQueueDashPlugin = fastifyQueuedashPlugin;
