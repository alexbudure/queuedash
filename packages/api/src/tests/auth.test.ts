import * as trpcNodeHttp from "@trpc/server/adapters/node-http";
import type {
  NextFunction,
  Request,
  Response as ExpressResponse,
} from "express";
import fastify from "fastify";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  createQueuedashSessionCookie,
  createQueuedashSessionToken,
  getQueuedashAuthMode,
  isQueuedashBasicAuthorized,
  isQueuedashSessionAuthorized,
  QUEUEDASH_AUTH_CHALLENGE,
  QUEUEDASH_SESSION_COOKIE,
  type QueuedashAuthOptions,
} from "../server-adapters/auth";
import { queuedash } from "../server-adapters/elysia";
import { createQueuedashExpressMiddleware } from "../server-adapters/express";
import { fastifyQueuedashPlugin } from "../server-adapters/fastify";
import { createHonoAdapter } from "../server-adapters/hono";
import type { Context } from "../trpc";

vi.mock("@trpc/server/adapters/node-http", () => ({
  nodeHTTPRequestHandler: vi.fn().mockResolvedValue(undefined),
}));

const auth = {
  username: "queuedash-admin",
  password: "correct horse:battery staple",
} satisfies QueuedashAuthOptions;
const basicAuth = { ...auth, mode: "basic" as const };
const authorization = `Basic ${Buffer.from(
  `${auth.username}:${auth.password}`,
).toString("base64")}`;
const ctx = { queues: [] } satisfies Context;

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

describe("authentication helpers", () => {
  it("defaults configured authentication to the login session", () => {
    expect(getQueuedashAuthMode(undefined)).toBeUndefined();
    expect(getQueuedashAuthMode(auth)).toBe("session");
    expect(getQueuedashAuthMode(basicAuth)).toBe("basic");
    expect(() =>
      getQueuedashAuthMode({ ...auth, mode: "invalid" as never }),
    ).toThrow('Queuedash auth mode must be either "session" or "basic"');
  });

  it("accepts only the configured Basic credentials", () => {
    expect(isQueuedashBasicAuthorized(undefined, undefined)).toBe(true);
    expect(isQueuedashBasicAuthorized(authorization, auth)).toBe(true);
    expect(isQueuedashBasicAuthorized(undefined, auth)).toBe(false);
    expect(isQueuedashBasicAuthorized("Bearer token", auth)).toBe(false);
    expect(
      isQueuedashBasicAuthorized(
        `Basic ${Buffer.from(`${auth.username}:wrong`).toString("base64")}`,
        auth,
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
    }) as Request;

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
    const handler = createQueuedashExpressMiddleware({ ctx });
    const result = createResponse();

    await handler(
      createRequest({ path: "/trpc/queue.list" }),
      result.response,
      vi.fn() as NextFunction,
    );

    expect(result.spies.set).toHaveBeenCalledWith(
      "Cache-Control",
      "private, no-store",
    );
    expect(
      vi.mocked(trpcNodeHttp.nodeHTTPRequestHandler),
    ).toHaveBeenCalledOnce();
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
      "WWW-Authenticate": QUEUEDASH_AUTH_CHALLENGE,
    });
  });
});

describe("Fastify adapter auth", () => {
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
