import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import * as trpcNodeHttp from "@trpc/server/adapters/node-http";
import express, {
  type NextFunction,
  type Request as ExpressRequest,
  type Response as ExpressResponse,
} from "express";
import fastify, { type FastifyInstance } from "fastify";
import { Hono } from "hono";
import { describe, expect, it, type Mock, vi } from "vitest";

import { getQueueRegistry } from "../queue-registry";
import { appRouter } from "../routers/_app";
import {
  createQueuedashSessionCookie,
  createQueuedashSessionToken,
  getQueuedashAuthMode,
  isQueuedashBasicAuthorized,
  isQueuedashSessionAuthorized,
  QUEUEDASH_AUTH_CHALLENGE,
  QUEUEDASH_SESSION_COOKIE,
  type QueuedashAuthOptions,
  rejectNonJsonPost,
  validateQueuedashAuthOptions,
} from "../server-adapters/auth";
import { queuedash } from "../server-adapters/elysia";
import { createQueuedashExpressMiddleware } from "../server-adapters/express";
import { fastifyQueuedashPlugin } from "../server-adapters/fastify";
import { createHonoAdapter } from "../server-adapters/hono";
import type { Context } from "../trpc";

// Real tRPC handling by default; tests that drive the Express middleware with
// stub requests override single calls.
vi.mock("@trpc/server/adapters/node-http", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@trpc/server/adapters/node-http")>();
  return {
    ...actual,
    nodeHTTPRequestHandler: vi.fn(actual.nodeHTTPRequestHandler),
  };
});
vi.mock("../queue-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../queue-registry")>();
  return { ...actual, getQueueRegistry: vi.fn(actual.getQueueRegistry) };
});

const auth = {
  username: "queuedash-admin",
  password: "correct horse:battery staple",
} satisfies QueuedashAuthOptions;
const basicAuth = { ...auth, mode: "basic" as const };
const toAuthorization = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
const authorization = toAuthorization(auth.username, auth.password);
const wrongAuthorization = toAuthorization(auth.username, "wrong");
const ctx = { queues: [] } satisfies Context;
// Untyped configuration (environment variables, JSON, YAML) can carry these.
const invalidAuthOptions: Array<[unknown, string]> = [
  [
    { ...auth, mode: "Session" },
    'Queuedash auth mode must be either "session" or "basic"',
  ],
  [
    { ...auth, password: 1234 },
    "Queuedash auth.password must be a non-empty string",
  ],
  [
    { ...auth, username: "" },
    "Queuedash auth.username must be a non-empty string",
  ],
  [
    { username: "", password: "" },
    "Queuedash auth.username must be a non-empty string",
  ],
  [
    { ...auth, password: "" },
    "Queuedash auth.password must be a non-empty string",
  ],
  [
    { ...auth, session: { secret: 42 } },
    "Queuedash auth.session.secret must be a string",
  ],
];

const getCookie = (response: Response): string => {
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toContain(`${QUEUEDASH_SESSION_COOKIE}=`);
  return setCookie!.split(";")[0];
};

const expectSessionUnauthorized = (response: Response) => {
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
};

const expectBasicChallenge = (response: Response) => {
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBe(
    QUEUEDASH_AUTH_CHALLENGE,
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
};

const expectNotFound = (response: Response) => {
  expect(response.status).toBe(404);
  expect(response.headers.get("www-authenticate")).toBeNull();
};

const expectTrpc = (response: Response, status = 200) => {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
};

const expectShell = async (response: Response, authBaseUrl?: string) => {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  const html = await response.text();
  if (authBaseUrl) {
    expect(html).toContain(`"auth":{"baseUrl":"${authBaseUrl}"}`);
  } else {
    expect(html).not.toContain('"auth":');
  }
};

/** A context whose one queue records pause calls, to see mutations run. */
const createPausableContext = () => {
  const pause = vi.fn().mockResolvedValue(undefined);
  const context = {
    queues: [
      { type: "bull", displayName: "Test", queue: { name: "test", pause } },
    ],
  } as unknown as Context;
  return { context, pause };
};

const postJson = (headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { ...headers, "content-type": "application/json" },
  body: "{}",
});

/** What an HTML form on another site can send without a CORS preflight. */
const postForm = (headers: Record<string, string> = {}): RequestInit => {
  const body = new FormData();
  body.append("queueName", "test");
  return { method: "POST", headers, body };
};

const adapters = ["Express", "Fastify", "Hono", "Elysia"] as const;

type MountedAdapter = {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
};

/** Mounts an adapter at /queuedash the way the README shows. */
const mountAdapter = async (
  adapter: (typeof adapters)[number],
  { auth, ctx }: { auth?: QueuedashAuthOptions; ctx: Context },
): Promise<MountedAdapter> => {
  switch (adapter) {
    case "Express": {
      const app = express();
      app.use("/queuedash", createQueuedashExpressMiddleware({ auth, ctx }));
      const server = app.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;
      return {
        request: (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init),
        close: () => new Promise((resolve) => server.close(() => resolve())),
      };
    }
    case "Fastify": {
      const app = fastify();
      app.register(fastifyQueuedashPlugin, {
        auth,
        baseUrl: "/queuedash",
        ctx,
      });
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      return {
        request: (path, init) => fetch(`${address}${path}`, init),
        close: () => app.close(),
      };
    }
    case "Hono": {
      const app = new Hono().route(
        "/queuedash",
        createHonoAdapter({ auth, baseUrl: "/queuedash", ctx }),
      );
      return {
        request: async (path, init) => app.request(path, init),
        close: async () => {},
      };
    }
    case "Elysia": {
      const app = queuedash({ auth, baseUrl: "/queuedash", ctx });
      return {
        request: (path, init) =>
          app.handle(new Request(`http://localhost${path}`, init)),
        close: async () => {},
      };
    }
  }
};

/** Only a JSON POST may run a mutation; `headers` carry any credentials. */
const expectJsonOnlyMutations = async (
  app: MountedAdapter,
  pause: Mock,
  headers: Record<string, string> = {},
) => {
  const form = await app.request(
    "/queuedash/trpc/queue.pauseAll",
    postForm(headers),
  );
  expect(form.status).toBe(415);
  expect(pause).not.toHaveBeenCalled();

  expectTrpc(
    await app.request("/queuedash/trpc/queue.pauseAll", postJson(headers)),
  );
  expect(pause).toHaveBeenCalledOnce();
};

describe("authentication helpers", () => {
  it("defaults configured authentication to the login session", () => {
    expect(getQueuedashAuthMode(undefined)).toBeUndefined();
    expect(getQueuedashAuthMode(auth)).toBe("session");
    expect(getQueuedashAuthMode(basicAuth)).toBe("basic");
    expect(() =>
      getQueuedashAuthMode({ ...auth, mode: "invalid" as never }),
    ).toThrow('Queuedash auth mode must be either "session" or "basic"');
  });

  it("rejects invalid auth options before an adapter serves anything", () => {
    expect(validateQueuedashAuthOptions(undefined)).toBeUndefined();
    expect(validateQueuedashAuthOptions(auth)).toBe("session");
    expect(validateQueuedashAuthOptions(basicAuth)).toBe("basic");
    for (const [options, message] of invalidAuthOptions) {
      expect(() =>
        validateQueuedashAuthOptions(options as QueuedashAuthOptions),
      ).toThrow(message);
    }
  });

  it("accepts only the configured Basic credentials", () => {
    expect(isQueuedashBasicAuthorized(undefined, undefined)).toBe(true);
    expect(isQueuedashBasicAuthorized(authorization, auth)).toBe(true);
    expect(isQueuedashBasicAuthorized(undefined, auth)).toBe(false);
    expect(isQueuedashBasicAuthorized("Bearer token", auth)).toBe(false);
    expect(isQueuedashBasicAuthorized(wrongAuthorization, auth)).toBe(false);
  });

  it("never authorizes empty credentials", () => {
    const empty = {
      username: "",
      password: "",
      session: { secret: "a-long-random-deployment-secret" },
    };
    expect(isQueuedashBasicAuthorized(toAuthorization("", ""), empty)).toBe(
      false,
    );
    // A token signed with the empty credentials and a known secret.
    const forged = createQueuedashSessionToken(empty);
    expect(
      isQueuedashSessionAuthorized(
        `${QUEUEDASH_SESSION_COOKIE}=${forged}`,
        empty,
      ),
    ).toBe(false);
  });

  it("signs, expires, and scopes session cookies", () => {
    const now = Date.now();
    const shortAuth = {
      ...auth,
      session: { ttlSeconds: 60, secure: true },
    };
    const token = createQueuedashSessionToken(shortAuth, now);

    expect(
      isQueuedashSessionAuthorized(
        `${QUEUEDASH_SESSION_COOKIE}=${token}`,
        shortAuth,
        now + 59_000,
      ),
    ).toBe(true);
    expect(
      isQueuedashSessionAuthorized(
        `${QUEUEDASH_SESSION_COOKIE}=${token}`,
        shortAuth,
        now + 60_001,
      ),
    ).toBe(false);
    expect(
      isQueuedashSessionAuthorized(
        `${QUEUEDASH_SESSION_COOKIE}=${token}x`,
        shortAuth,
        now,
      ),
    ).toBe(false);

    const cookie = createQueuedashSessionCookie({
      auth: shortAuth,
      baseUrl: "/admin/queuedash/",
      requestIsSecure: false,
    });
    expect(cookie).toContain("Path=/admin/queuedash");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
  });

  it("supports a shared signing secret across application instances", () => {
    const firstInstance = {
      ...auth,
      session: { secret: "a-long-random-deployment-secret" },
    };
    const secondInstance = {
      ...auth,
      session: { secret: "a-long-random-deployment-secret" },
    };
    const token = createQueuedashSessionToken(firstInstance);

    expect(
      isQueuedashSessionAuthorized(
        `${QUEUEDASH_SESSION_COOKIE}=${token}`,
        secondInstance,
      ),
    ).toBe(true);
    expect(
      isQueuedashSessionAuthorized(`${QUEUEDASH_SESSION_COOKIE}=${token}`, {
        ...auth,
      }),
    ).toBe(false);
  });
});

describe("Express adapter auth", () => {
  const createRequest = ({
    authorizationHeader,
    cookie,
    method = "GET",
    path,
  }: {
    authorizationHeader?: string;
    cookie?: string;
    method?: string;
    path: string;
  }) =>
    ({
      baseUrl: "/queuedash",
      headers: { authorization: authorizationHeader, cookie },
      method,
      path,
      secure: false,
    }) as ExpressRequest;

  const createResponse = () => {
    const response = {
      send: vi.fn(),
      set: vi.fn(),
      status: vi.fn(),
      type: vi.fn(),
    };
    response.send.mockReturnValue(response);
    response.set.mockReturnValue(response);
    response.status.mockReturnValue(response);
    response.type.mockReturnValue(response);

    return {
      response: response as unknown as ExpressResponse,
      spies: response,
    };
  };

  it("serves the branded login shell and protects only data routes", async () => {
    const handler = createQueuedashExpressMiddleware({ auth, ctx });
    const ui = createResponse();

    await handler(
      createRequest({ path: "/" }),
      ui.response,
      vi.fn() as NextFunction,
    );
    expect(ui.spies.type).toHaveBeenCalledWith("text/html");
    expect(ui.spies.send.mock.calls[0][0]).toContain(
      '"baseUrl":"/queuedash/auth"',
    );

    const api = createResponse();
    await handler(
      createRequest({ path: "/trpc/queue.list" }),
      api.response,
      vi.fn() as NextFunction,
    );
    expect(api.spies.status).toHaveBeenCalledWith(401);
    expect(api.spies.set).toHaveBeenCalledWith({
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    });
  });

  it("creates, checks, and clears a login session", async () => {
    const handler = createQueuedashExpressMiddleware({ auth, ctx });
    const login = createResponse();
    await handler(
      createRequest({
        authorizationHeader: authorization,
        method: "POST",
        path: "/auth/login",
      }),
      login.response,
      vi.fn() as NextFunction,
    );
    expect(login.spies.status).toHaveBeenCalledWith(204);

    const setHeaders = login.spies.set.mock.calls[0][0] as Record<
      string,
      string
    >;
    const cookie = setHeaders["Set-Cookie"].split(";")[0];
    const session = createResponse();
    await handler(
      createRequest({ cookie, path: "/auth/session" }),
      session.response,
      vi.fn() as NextFunction,
    );
    expect(session.spies.status).toHaveBeenCalledWith(204);

    const logout = createResponse();
    await handler(
      createRequest({ cookie, method: "POST", path: "/auth/logout" }),
      logout.response,
      vi.fn() as NextFunction,
    );
    expect(logout.spies.set.mock.calls[0][0]["Set-Cookie"]).toContain(
      "Max-Age=0",
    );
  });

  it("marks successful tRPC responses private and non-cacheable", async () => {
    const trpcHandler = vi.mocked(trpcNodeHttp.nodeHTTPRequestHandler);
    trpcHandler.mockClear().mockResolvedValueOnce(undefined);
    const handler = createQueuedashExpressMiddleware({ ctx });
    const result = createResponse();

    await handler(
      createRequest({ path: "/trpc/queue.list" }),
      result.response,
      vi.fn() as NextFunction,
    );

    expect(result.spies.set).toHaveBeenCalledWith({
      "Cache-Control": "private, no-store",
    });
    expect(trpcHandler).toHaveBeenCalledOnce();
  });

  it("retains browser challenge mode as an explicit option", async () => {
    const handler = createQueuedashExpressMiddleware({
      auth: basicAuth,
      ctx,
    });
    const result = createResponse();

    await handler(
      createRequest({ path: "/" }),
      result.response,
      vi.fn() as NextFunction,
    );
    expect(result.spies.set).toHaveBeenCalledWith({
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "WWW-Authenticate": QUEUEDASH_AUTH_CHALLENGE,
    });
  });

  it("passes unexpected errors to next instead of rejecting", async () => {
    // Express 4 does not catch a rejected handler, so a rejection would be
    // unhandled and end the host process.
    const failure = new Error("tRPC handler failed");
    vi.mocked(trpcNodeHttp.nodeHTTPRequestHandler).mockRejectedValueOnce(
      failure,
    );
    const handler = createQueuedashExpressMiddleware({ ctx });
    const next = vi.fn();

    await expect(
      handler(
        createRequest({ path: "/trpc/queue.list" }),
        createResponse().response,
        next,
      ),
    ).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe("Fastify adapter auth", () => {
  it("authenticates and serves batches larger than Fastify's named-parameter limit", async () => {
    const app = fastify();
    const pause = vi.fn().mockResolvedValue(undefined);
    app.register(fastifyQueuedashPlugin, {
      auth,
      baseUrl: "/queuedash",
      ctx: {
        queues: [
          { type: "bull", displayName: "Test", queue: { name: "test", pause } },
        ],
      } as unknown as Context,
    });
    const cookie = `${QUEUEDASH_SESSION_COOKIE}=${createQueuedashSessionToken(auth)}`;
    try {
      const paths = Array(100).fill("settings.get").join(",");
      for (const base of ["/queuedash/trpc", "/queuedash/%74rpc"]) {
        const url = `${base}/${paths}?batch=1`;
        expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
        const response = await app.inject({
          method: "GET",
          url,
          headers: { cookie },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toHaveLength(100);
        expect(
          response.json().every((item: { result?: unknown }) => item.result),
        ).toBe(true);
      }
      const response = await app.inject({
        method: "POST",
        url: `/queuedash/trpc/${Array(8).fill("queue.pauseAll").join(",")}?batch=1`,
        headers: { cookie, "content-type": "application/json" },
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(pause).toHaveBeenCalledTimes(8);
    } finally {
      await app.close();
    }
  });

  it("supports login sessions without blocking the app shell", async () => {
    const app = fastify();
    app.register(fastifyQueuedashPlugin, {
      auth,
      baseUrl: "/queuedash",
      ctx,
    });

    try {
      const ui = await app.inject({ method: "GET", url: "/queuedash" });
      expect(ui.statusCode).toBe(200);
      expect(ui.body).toContain('"baseUrl":"/queuedash/auth"');

      const api = await app.inject({
        method: "GET",
        url: "/queuedash/trpc/queue.list",
      });
      expect(api.statusCode).toBe(401);
      expect(api.headers["www-authenticate"]).toBeUndefined();

      const encodedApi = await app.inject({
        method: "GET",
        url: "/queuedash/%74rpc/queue.list",
      });
      expect(encodedApi.statusCode).toBe(401);
      expect(encodedApi.headers["www-authenticate"]).toBeUndefined();

      const login = await app.inject({
        method: "POST",
        url: "/queuedash/auth/login",
        headers: { authorization },
      });
      expect(login.statusCode).toBe(204);
      const setCookie = login.headers["set-cookie"]!;
      const cookie = (
        Array.isArray(setCookie) ? setCookie[0] : setCookie
      ).split(";")[0];

      const session = await app.inject({
        method: "GET",
        url: "/queuedash/auth/session",
        headers: { cookie },
      });
      expect(session.statusCode).toBe(204);

      const authorizedApi = await app.inject({
        method: "GET",
        url: "/queuedash/trpc/queue.list",
        headers: { cookie },
      });
      expect(authorizedApi.statusCode).toBe(200);
      expect(authorizedApi.headers["cache-control"]).toBe("private, no-store");
    } finally {
      await app.close();
    }
  });
});

describe("Fastify adapter under a route prefix", () => {
  // Both put the plugin's routes under /admin, which the routes themselves do
  // not name.
  const mounts: Record<
    string,
    (
      app: FastifyInstance,
      options: Parameters<typeof fastifyQueuedashPlugin>[1],
    ) => void
  > = {
    "register(plugin, { prefix })": (app, options) => {
      app.register(fastifyQueuedashPlugin, { ...options, prefix: "/admin" });
    },
    "a nested register": (app, options) => {
      app.register(
        async (admin) => {
          await admin.register(fastifyQueuedashPlugin, options);
        },
        { prefix: "/admin" },
      );
    },
  };

  it.each(Object.entries(mounts))(
    "requires a session for tRPC when mounted with %s",
    async (_, mount) => {
      const { context, pause } = createPausableContext();
      const app = fastify();
      mount(app, { auth, baseUrl: "/queuedash", ctx: context });

      try {
        const api = await app.inject({
          method: "GET",
          url: "/admin/queuedash/trpc/settings.get",
        });
        expect(api.statusCode).toBe(401);
        expect(api.headers["cache-control"]).toBe("no-store");
        const pauseAll = await app.inject({
          method: "POST",
          url: "/admin/queuedash/trpc/queue.pauseAll",
          headers: { "content-type": "application/json" },
          payload: "{}",
        });
        expect(pauseAll.statusCode).toBe(401);
        expect(pause).not.toHaveBeenCalled();

        // The shell and the cookie point at the prefixed paths.
        const shell = await app.inject({
          method: "GET",
          url: "/admin/queuedash/settings",
        });
        expect(shell.statusCode).toBe(200);
        expect(shell.body).toContain('"apiUrl":"/admin/queuedash/trpc"');
        expect(shell.body).toContain(
          '"auth":{"baseUrl":"/admin/queuedash/auth"}',
        );
        expect(shell.body).toContain('"basename":"/admin/queuedash"');

        const login = await app.inject({
          method: "POST",
          url: "/admin/queuedash/auth/login",
          headers: { authorization },
        });
        expect(login.statusCode).toBe(204);
        const setCookie = String(login.headers["set-cookie"]);
        expect(setCookie).toContain("; Path=/admin/queuedash;");
        const cookie = setCookie.split(";")[0];

        const authorizedApi = await app.inject({
          method: "GET",
          url: "/admin/queuedash/trpc/settings.get",
          headers: { cookie },
        });
        expect(authorizedApi.statusCode).toBe(200);
        expect(authorizedApi.headers["cache-control"]).toBe(
          "private, no-store",
        );
        const authorizedPause = await app.inject({
          method: "POST",
          url: "/admin/queuedash/trpc/queue.pauseAll",
          headers: { cookie, "content-type": "application/json" },
          payload: "{}",
        });
        expect(authorizedPause.statusCode).toBe(200);
        expect(pause).toHaveBeenCalledOnce();
      } finally {
        await app.close();
      }
    },
  );

  it.each(Object.entries(mounts))(
    "challenges every route in basic mode when mounted with %s",
    async (_, mount) => {
      const app = fastify();
      mount(app, { auth: basicAuth, baseUrl: "/queuedash", ctx });

      try {
        for (const url of [
          "/admin/queuedash",
          "/admin/queuedash/trpc/settings.get",
        ]) {
          const response = await app.inject({ method: "GET", url });
          expect(response.statusCode).toBe(401);
          expect(response.headers["www-authenticate"]).toBe(
            QUEUEDASH_AUTH_CHALLENGE,
          );
          expect(
            (
              await app.inject({
                method: "GET",
                url,
                headers: { authorization },
              })
            ).statusCode,
          ).toBe(200);
        }
      } finally {
        await app.close();
      }
    },
  );
});

describe("Hono adapter auth", () => {
  it("supports login sessions without blocking the app shell", async () => {
    const app = new Hono().route(
      "/queuedash",
      createHonoAdapter({ auth, baseUrl: "/queuedash", ctx }),
    );

    const ui = await app.request("/queuedash");
    expect(ui.status).toBe(200);
    expect(await ui.text()).toContain('"baseUrl":"/queuedash/auth"');
    expectSessionUnauthorized(await app.request("/queuedash/trpc/queue.list"));

    const login = await app.request("/queuedash/auth/login", {
      method: "POST",
      headers: { authorization },
    });
    expect(login.status).toBe(204);
    const cookie = getCookie(login);
    expect(
      (
        await app.request("/queuedash/auth/session", {
          headers: { cookie },
        })
      ).status,
    ).toBe(204);

    const authorizedApi = await app.request("/queuedash/trpc/queue.list", {
      headers: { cookie },
    });
    expect(authorizedApi.status).toBe(200);
    expect(authorizedApi.headers.get("cache-control")).toBe(
      "private, no-store",
    );
  });
});

describe("Elysia adapter auth", () => {
  it("supports login sessions without blocking the app shell", async () => {
    const app = queuedash({ auth, baseUrl: "/queuedash", ctx });
    const ui = await app.handle(new Request("http://localhost/queuedash"));
    expect(ui.status).toBe(200);
    expect(await ui.text()).toContain('"baseUrl":"/queuedash/auth"');

    for (const path of ["settings", "email-delivery"]) {
      const deepLink = await app.handle(
        new Request(`http://localhost/queuedash/${path}`),
      );
      expect(deepLink.status).toBe(200);
      expect(await deepLink.text()).toContain('"baseUrl":"/queuedash/auth"');

      const head = await app.handle(
        new Request(`http://localhost/queuedash/${path}`, {
          method: "HEAD",
        }),
      );
      expect(head.status).toBe(200);
      expect(head.headers.get("content-type")).toContain("text/html");
      expect(await head.text()).toBe("");
    }

    expect(
      (
        await app.handle(
          new Request("http://localhost/queuedash/settings", {
            method: "POST",
          }),
        )
      ).status,
    ).toBe(404);
    expectSessionUnauthorized(
      await app.handle(
        new Request("http://localhost/queuedash/auth/session", {
          method: "HEAD",
        }),
      ),
    );

    expectSessionUnauthorized(
      await app.handle(
        new Request("http://localhost/queuedash/trpc/queue.list"),
      ),
    );

    const login = await app.handle(
      new Request("http://localhost/queuedash/auth/login", {
        method: "POST",
        headers: { authorization },
      }),
    );
    expect(login.status).toBe(204);
    const cookie = getCookie(login);
    expect(
      (
        await app.handle(
          new Request("http://localhost/queuedash/auth/session", {
            headers: { cookie },
          }),
        )
      ).status,
    ).toBe(204);

    const api = await app.handle(
      new Request("http://localhost/queuedash/trpc/queue.list", {
        headers: { cookie },
      }),
    );
    expect(api.status).toBe(200);
    expect(api.headers.get("cache-control")).toBe("private, no-store");
    expect(await api.json()).toMatchObject({ result: { data: [] } });
  });

  it("retains the browser challenge when basic mode is selected", async () => {
    const app = queuedash({ auth: basicAuth, baseUrl: "/queuedash", ctx });
    expectBasicChallenge(
      await app.handle(new Request("http://localhost/queuedash")),
    );
    expectBasicChallenge(
      await app.handle(new Request("http://localhost/queuedash/settings")),
    );
    expectBasicChallenge(
      await app.handle(
        new Request("http://localhost/queuedash/settings", {
          method: "HEAD",
        }),
      ),
    );
    expectBasicChallenge(
      await app.handle(
        new Request("http://localhost/queuedash/email-delivery"),
      ),
    );
  });
});

// The same requests, answered the same way by every adapter.
describe.each(adapters)("%s adapter routes", (adapter) => {
  it("challenges every path in basic mode", async () => {
    const { context, pause } = createPausableContext();
    const app = await mountAdapter(adapter, { auth: basicAuth, ctx: context });
    const headers = { authorization };

    try {
      for (const [method, path] of [
        ["GET", "/queuedash"],
        ["GET", "/queuedash/settings"],
        ["HEAD", "/queuedash/settings"],
        ["POST", "/queuedash/settings"],
        ["GET", "/queuedash/trpc"],
        ["GET", "/queuedash/trpc/settings.get"],
        ["POST", "/queuedash/trpc/queue.pauseAll"],
        ["GET", "/queuedash/auth"],
        ["GET", "/queuedash/auth/session"],
        ["POST", "/queuedash/auth/login"],
        ["POST", "/queuedash/auth/logout"],
        ["GET", "/queuedash/auth/anything"],
      ]) {
        expectBasicChallenge(await app.request(path, { method }));
        expectBasicChallenge(
          await app.request(path, {
            method,
            headers: { authorization: wrongAuthorization },
          }),
        );
      }
      expect(pause).not.toHaveBeenCalled();

      await expectShell(await app.request("/queuedash", { headers }));
      await expectShell(await app.request("/queuedash/settings", { headers }));
      expectNotFound(
        await app.request("/queuedash/settings", { method: "POST", headers }),
      );
      expectTrpc(
        await app.request("/queuedash/trpc/settings.get", { headers }),
      );
      expectTrpc(await app.request("/queuedash/trpc", { headers }), 404);
      await expectJsonOnlyMutations(app, pause, headers);
      // Once authenticated there is nothing under /auth in basic mode.
      for (const [method, path] of [
        ["GET", "/queuedash/auth"],
        ["GET", "/queuedash/auth/session"],
        ["POST", "/queuedash/auth/login"],
        ["POST", "/queuedash/auth/logout"],
        ["GET", "/queuedash/auth/anything"],
      ]) {
        expectNotFound(await app.request(path, { method, headers }));
      }
    } finally {
      await app.close();
    }
  });

  it("requires a session for tRPC in session mode", async () => {
    const { context, pause } = createPausableContext();
    const app = await mountAdapter(adapter, { auth, ctx: context });

    try {
      await expectShell(await app.request("/queuedash"), "/queuedash/auth");
      await expectShell(
        await app.request("/queuedash/settings"),
        "/queuedash/auth",
      );
      const head = await app.request("/queuedash/settings", {
        method: "HEAD",
      });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      expectNotFound(
        await app.request("/queuedash/settings", { method: "POST" }),
      );

      expectSessionUnauthorized(await app.request("/queuedash/trpc"));
      expectSessionUnauthorized(
        await app.request("/queuedash/trpc/settings.get"),
      );
      expectSessionUnauthorized(
        await app.request("/queuedash/trpc/queue.pauseAll", postJson()),
      );
      expectSessionUnauthorized(
        await app.request("/queuedash/trpc/queue.pauseAll", postForm()),
      );
      expect(pause).not.toHaveBeenCalled();

      expectSessionUnauthorized(await app.request("/queuedash/auth/session"));
      for (const [method, path] of [
        ["GET", "/queuedash/auth"],
        ["GET", "/queuedash/auth/anything"],
        ["GET", "/queuedash/auth/login"],
        ["GET", "/queuedash/auth/logout"],
        ["POST", "/queuedash/auth/session"],
      ]) {
        expectNotFound(await app.request(path, { method }));
      }
      const badLogins: Array<Record<string, string>> = [
        {},
        { authorization: wrongAuthorization },
      ];
      for (const headers of badLogins) {
        expectSessionUnauthorized(
          await app.request("/queuedash/auth/login", {
            method: "POST",
            headers,
          }),
        );
      }

      const login = await app.request("/queuedash/auth/login", {
        method: "POST",
        headers: { authorization },
      });
      expect(login.status).toBe(204);
      expect(login.headers.get("set-cookie")).toContain(
        "; Path=/queuedash; HttpOnly; SameSite=Strict;",
      );
      const cookie = getCookie(login);
      expect(
        (await app.request("/queuedash/auth/session", { headers: { cookie } }))
          .status,
      ).toBe(204);
      expectTrpc(
        await app.request("/queuedash/trpc/settings.get", {
          headers: { cookie },
        }),
      );
      await expectJsonOnlyMutations(app, pause, { cookie });
      expectNotFound(
        await app.request("/queuedash/auth/anything", { headers: { cookie } }),
      );

      const logout = await app.request("/queuedash/auth/logout", {
        method: "POST",
        headers: { cookie },
      });
      expect(logout.status).toBe(204);
      expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    } finally {
      await app.close();
    }
  });

  it("serves no auth routes when auth is off", async () => {
    const { context, pause } = createPausableContext();
    const app = await mountAdapter(adapter, { ctx: context });

    try {
      await expectShell(await app.request("/queuedash"));
      for (const [method, path] of [
        ["GET", "/queuedash/auth/session"],
        ["POST", "/queuedash/auth/login"],
        ["POST", "/queuedash/auth/logout"],
        ["GET", "/queuedash/auth/anything"],
        ["POST", "/queuedash/settings"],
      ]) {
        expectNotFound(
          await app.request(path, { method, headers: { authorization } }),
        );
      }
      expectTrpc(await app.request("/queuedash/trpc/settings.get"));
      await expectJsonOnlyMutations(app, pause);
      expectTrpc(
        await app.request("/queuedash/trpc/queue.pauseAll", {
          method: "POST",
          headers: { "content-type": "application/json; charset=utf-8" },
          body: "{}",
        }),
      );
    } finally {
      await app.close();
    }
  });

  it("refuses invalid auth options when it is mounted", async () => {
    for (const [options, message] of invalidAuthOptions) {
      await expect(
        mountAdapter(adapter, {
          auth: options as QueuedashAuthOptions,
          ctx,
        }),
      ).rejects.toThrow(message);
    }
  });

  it("fails closed on empty credentials", async () => {
    await expect(
      mountAdapter(adapter, { auth: { username: "", password: "" }, ctx }),
    ).rejects.toThrow("Queuedash auth.username must be a non-empty string");

    // Credentials emptied after mounting still authorize nothing.
    const mutable = {
      ...auth,
      session: { secret: "a-long-random-deployment-secret" },
    };
    const app = await mountAdapter(adapter, { auth: mutable, ctx });
    try {
      Object.assign(mutable, { username: "", password: "" });
      const forged = createQueuedashSessionToken(mutable);
      expectSessionUnauthorized(
        await app.request("/queuedash/trpc/settings.get", {
          headers: { cookie: `${QUEUEDASH_SESSION_COOKIE}=${forged}` },
        }),
      );
      expectSessionUnauthorized(
        await app.request("/queuedash/auth/login", {
          method: "POST",
          headers: { authorization: toAuthorization("", "") },
        }),
      );
    } finally {
      await app.close();
    }
  });

  it("hands tRPC the configured context on every request", async () => {
    const context = { queues: [] } satisfies Context;
    const app = await mountAdapter(adapter, { ctx: context });
    const registryLookups = vi.mocked(getQueueRegistry);
    registryLookups.mockClear();

    try {
      for (let request = 0; request < 2; request += 1) {
        expectTrpc(await app.request("/queuedash/trpc/settings.get"));
      }
      // A copy per request would build a new queue registry, and reopen
      // discovery's Redis connections, on every request.
      const contexts = registryLookups.mock.calls.map(([received]) => received);
      expect(contexts.length).toBeGreaterThanOrEqual(2);
      expect(contexts.every((received) => received === context)).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe("rejectNonJsonPost", () => {
  const post = (contentType?: string) =>
    new Request("http://localhost/api/queuedash/queue.pauseAll", {
      method: "POST",
      ...(contentType === undefined
        ? {}
        : { headers: { "content-type": contentType }, body: "{}" }),
    });

  it("answers a POST that isn't JSON as the adapters do", async () => {
    for (const contentType of [
      undefined,
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
      // Still a form: the media type decides, not a substring.
      "multipart/form-data; boundary=x; application/json",
    ]) {
      const response = rejectNonJsonPost(post(contentType));
      expect(response?.status).toBe(415);
      expect(response?.headers.get("cache-control")).toBe("no-store");
      expect(await response?.text()).toBe(
        "Content-Type must be application/json",
      );
    }
    for (const contentType of [
      "application/json",
      "Application/JSON ; charset=utf-8",
    ]) {
      expect(rejectNonJsonPost(post(contentType))).toBeUndefined();
    }
    expect(
      rejectNonJsonPost(
        new Request("http://localhost/api/queuedash/queue.list"),
      ),
    ).toBeUndefined();
  });

  it("guards a handler written like the Next.js README's", async () => {
    const { context, pause } = createPausableContext();
    const handler = async (req: Request) => {
      const rejected = rejectNonJsonPost(req);
      if (rejected) return rejected;

      const response = await fetchRequestHandler({
        endpoint: "/queuedash/trpc",
        req,
        router: appRouter,
        createContext: () => context,
      });
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    };
    const app: MountedAdapter = {
      request: (path, init) =>
        handler(new Request(`http://localhost${path}`, init)),
      close: async () => {},
    };

    expectTrpc(await app.request("/queuedash/trpc/settings.get"));
    await expectJsonOnlyMutations(app, pause);
  });
});
