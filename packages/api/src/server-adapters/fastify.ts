import * as trpcFastify from "@trpc/server/adapters/fastify";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  onRequestHookHandler,
  preHandlerHookHandler,
  RouteShorthandOptions,
} from "fastify";

import { closeQueuedashContext } from "../queue-registry";
import { appRouter } from "../routers/_app";
import type { Context } from "../trpc";
import {
  getQueuedashRoute,
  type QueuedashAuthMode,
  type QueuedashAuthOptions,
  type QueuedashResponse,
  type QueuedashRoute,
  resolveQueuedashRequest,
  validateQueuedashAuthOptions,
} from "./auth";
import { createQueuedashHtml } from "./utils";

export type FastifyQueuedashHooksOptions = Partial<{
  onRequest?: onRequestHookHandler;
  preHandler?: preHandlerHookHandler;
}>;

/** @deprecated Use FastifyQueuedashHooksOptions instead. */
export type FastifyQueueDashHooksOptions = FastifyQueuedashHooksOptions;

const send = (
  res: FastifyReply,
  { status, headers, body }: QueuedashResponse,
) => res.headers(headers).code(status).send(body);

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
  done: (error?: Error) => void,
): void {
  let authMode: QueuedashAuthMode | undefined;
  try {
    authMode = validateQueuedashAuthOptions(auth);
  } catch (error) {
    // avvio does not catch a synchronous throw from a callback plugin, so it
    // would escape as an uncaught exception instead of rejecting ready().
    done(error as Error);
    return;
  }
  // Routes are registered beneath any prefix the host mounted this plugin
  // under, and the browser needs that full path for the dashboard's links,
  // its API calls, and the session cookie.
  const mountPath = `${fastify.prefix}${baseUrl}`;
  const resolve = (req: FastifyRequest, route: QueuedashRoute) =>
    resolveQueuedashRequest(auth, {
      route,
      method: req.method,
      authorization: req.headers.authorization,
      cookie: req.headers.cookie,
      contentType: req.headers["content-type"],
      baseUrl: mountPath,
      isSecure: req.protocol === "https",
    });

  fastify.addHook("onClose", async () => {
    await closeQueuedashContext(ctx);
  });

  const authorizeDashboard = async (req: FastifyRequest, res: FastifyReply) => {
    const { "*": path = "" } = req.params as { "*"?: string };
    const route = getQueuedashRoute(req.method, `/${path}`);
    // The tRPC routes below own /trpc. Nothing that reaches these routes may
    // run it, however the router happened to match the path.
    const decision = resolve(req, route === "trpc" ? "not-found" : route);
    if (decision.type === "respond") return send(res, decision);
  };
  // Every method is routed here so that each path under baseUrl gets the
  // shared decision, and it runs before any hooks the host added for the UI.
  const dashboardOptions = (): RouteShorthandOptions => {
    const onRequest: onRequestHookHandler[] = [authorizeDashboard];
    return {
      ...uiHooks,
      onRequest: onRequest.concat(uiHooks?.onRequest ?? []),
    };
  };
  const serveApp = (_: FastifyRequest, res: FastifyReply) => {
    res
      .type("text/html")
      .send(
        createQueuedashHtml(
          mountPath,
          ctx.ui,
          authMode === "session" ? { baseUrl: `${mountPath}/auth` } : undefined,
        ),
      );
  };
  fastify.all(baseUrl, dashboardOptions(), serveApp);
  fastify.all(`${baseUrl}/*`, dashboardOptions(), serveApp);

  fastify.register(
    (rpc, _options, ready) => {
      // A hook in this encapsulated context covers exactly the tRPC routes
      // below, whatever prefix the host mounted the plugin under. Matching the
      // registered URL instead missed them beneath a prefix.
      rpc.addHook("onRequest", async (req, res) => {
        const decision = resolve(req, "trpc");
        if (decision.type === "respond") return send(res, decision);
        if (decision.type === "trpc") res.headers(decision.headers);
      });
      // tRPC reads JSON itself. Keep this parser scoped to the API routes.
      rpc.removeContentTypeParser("application/json");
      rpc.addContentTypeParser(
        "application/json",
        { parseAs: "string" },
        (_req, body, parsed) => parsed(null, body),
      );
      const handleTrpc = async (
        req: FastifyRequest<{ Params: { "*"?: string } }>,
        res: FastifyReply,
      ) => {
        await trpcFastify.fastifyRequestHandler({
          router: appRouter,
          createContext: () => ctx,
          req,
          res,
          path: req.params["*"] ?? "",
        });
      };
      rpc.all<{ Params: { "*"?: string } }>("/", handleTrpc);
      // A batch of eight queue.byName calls exceeds Fastify's default
      // 100-character named-parameter limit. Wildcards are not subject to it.
      rpc.all<{ Params: { "*"?: string } }>("/*", handleTrpc);
      ready();
    },
    { prefix: `${baseUrl}/trpc` },
  );

  done();
}

/** @deprecated Use fastifyQueuedashPlugin instead. */
export const fastifyQueueDashPlugin = fastifyQueuedashPlugin;
