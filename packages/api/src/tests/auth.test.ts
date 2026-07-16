import type {
  NextFunction,
  Request,
  Response as ExpressResponse,
} from "express";
import fastify from "fastify";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  isQueueDashAuthorized,
  QUEUEDASH_AUTH_CHALLENGE,
  type QueueDashAuthOptions,
} from "../server-adapters/auth";
import { queuedash } from "../server-adapters/elysia";
import { createQueueDashExpressMiddleware } from "../server-adapters/express";
import { fastifyQueueDashPlugin } from "../server-adapters/fastify";
import { createHonoAdapter } from "../server-adapters/hono";
import type { Context } from "../trpc";

const auth = {
  username: "queuedash-admin",
  password: "correct horse:battery staple",
} satisfies QueueDashAuthOptions;
const authorization = `Basic ${Buffer.from(
  `${auth.username}:${auth.password}`,
).toString("base64")}`;
const ctx = { queues: [] } satisfies Context;

const expectAuthChallenge = (response: Response) => {
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBe(
    QUEUEDASH_AUTH_CHALLENGE,
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
};

describe("HTTP Basic auth", () => {
  it("is disabled when no auth options are provided", () => {
    expect(isQueueDashAuthorized(undefined, undefined)).toBe(true);
  });

  it("accepts only the configured credentials", () => {
    expect(isQueueDashAuthorized(authorization, auth)).toBe(true);
    expect(isQueueDashAuthorized(undefined, auth)).toBe(false);
    expect(isQueueDashAuthorized("Bearer token", auth)).toBe(false);
    expect(
      isQueueDashAuthorized(`Basic ${Buffer.from(":").toString("base64")}`, {
        username: "",
        password: "",
      }),
    ).toBe(false);
    expect(
      isQueueDashAuthorized(
        `Basic ${Buffer.from(`${auth.username}:wrong`).toString("base64")}`,
        auth,
      ),
    ).toBe(false);
  });
});

describe("Express adapter auth", () => {
  const createRequest = (path: string, authorizationHeader?: string) =>
    ({
      baseUrl: "/queuedash",
      headers: { authorization: authorizationHeader },
      path,
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

  it("protects the UI and tRPC endpoint", async () => {
    const handler = createQueueDashExpressMiddleware({ auth, ctx });

    for (const path of ["/", "/trpc/queue.list"]) {
      const { response, spies } = createResponse();
      await handler(createRequest(path), response, vi.fn() as NextFunction);

      expect(spies.set).toHaveBeenCalledWith({
        "Cache-Control": "no-store",
        "WWW-Authenticate": QUEUEDASH_AUTH_CHALLENGE,
      });
      expect(spies.status).toHaveBeenCalledWith(401);
    }

    const { response, spies } = createResponse();
    await handler(
      createRequest("/", authorization),
      response,
      vi.fn() as NextFunction,
    );
    expect(spies.type).toHaveBeenCalledWith("text/html");
  });

  it("keeps the adapter public by default", async () => {
    const handler = createQueueDashExpressMiddleware({ ctx });
    const { response, spies } = createResponse();

    await handler(createRequest("/"), response, vi.fn() as NextFunction);

    expect(spies.type).toHaveBeenCalledWith("text/html");
    expect(spies.status).not.toHaveBeenCalledWith(401);
  });
});

describe("Fastify adapter auth", () => {
  it("protects the UI and tRPC endpoint", async () => {
    const app = fastify();
    app.register(fastifyQueueDashPlugin, {
      auth,
      baseUrl: "/queuedash",
      ctx,
    });

    try {
      const uiResponse = await app.inject({ method: "GET", url: "/queuedash" });
      expect(uiResponse.statusCode).toBe(401);
      expect(uiResponse.headers["www-authenticate"]).toBe(
        QUEUEDASH_AUTH_CHALLENGE,
      );
      expect(uiResponse.headers["cache-control"]).toBe("no-store");

      const apiResponse = await app.inject({
        method: "GET",
        url: "/queuedash/trpc/queue.list",
      });
      expect(apiResponse.statusCode).toBe(401);
      expect(apiResponse.headers["www-authenticate"]).toBe(
        QUEUEDASH_AUTH_CHALLENGE,
      );
      expect(apiResponse.headers["cache-control"]).toBe("no-store");

      const authenticatedResponse = await app.inject({
        method: "GET",
        url: "/queuedash",
        headers: { authorization },
      });
      expect(authenticatedResponse.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

describe("Hono adapter auth", () => {
  it("protects the UI and tRPC endpoint", async () => {
    const app = new Hono().route(
      "/queuedash",
      createHonoAdapter({ auth, baseUrl: "/queuedash", ctx }),
    );

    expectAuthChallenge(await app.request("/queuedash"));
    expectAuthChallenge(await app.request("/queuedash/trpc/queue.list"));
    expect(
      (await app.request("/queuedash", { headers: { authorization } })).status,
    ).toBe(200);
  });
});

describe("Elysia adapter auth", () => {
  it("protects the UI and tRPC endpoint", async () => {
    const app = queuedash({ auth, baseUrl: "/queuedash", ctx });

    expectAuthChallenge(
      await app.handle(new Request("http://localhost/queuedash")),
    );
    expectAuthChallenge(
      await app.handle(
        new Request("http://localhost/queuedash/trpc/queue.list"),
      ),
    );
    expect(
      (
        await app.handle(
          new Request("http://localhost/queuedash", {
            headers: { authorization },
          }),
        )
      ).status,
    ).toBe(200);
  });
});
