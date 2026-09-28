import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export type QueuedashAuthMode = "session" | "basic";

export type QueuedashAuthOptions = {
  username: string;
  password: string;
  /**
   * `session` renders the Queuedash login screen and authenticates requests
   * with an HttpOnly cookie. `basic` keeps the browser-native Basic Auth
   * challenge. Defaults to `session`.
   */
  mode?: QueuedashAuthMode;
  session?: {
    /**
     * Shared signing secret for sessions that must survive restarts or work
     * across multiple application instances. A random process-local secret is
     * used when omitted.
     */
    secret?: string;
    /**
     * Session lifetime in seconds. Defaults to 12 hours.
     */
    ttlSeconds?: number;
    /**
     * Force the Secure cookie attribute on or off. By default it follows the
     * request protocol.
     */
    secure?: boolean;
  };
};

/** @deprecated Use QueuedashAuthOptions instead. */
export type QueueDashAuthOptions = QueuedashAuthOptions;

export type QueuedashPublicAuthConfig = {
  baseUrl: string;
};

export const QUEUEDASH_AUTH_CHALLENGE =
  'Basic realm="Queuedash", charset="UTF-8"';
export const QUEUEDASH_AUTH_REQUIRED_MESSAGE = "Authentication required";
export const QUEUEDASH_SESSION_COOKIE = "queuedash_session";

const DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60;
const MIN_SESSION_TTL_SECONDS = 60;
const MAX_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const SESSION_TOKEN_VERSION = "v1";
const processSessionSecrets = new WeakMap<QueuedashAuthOptions, Buffer>();

const safeEqual = (actual: string, expected: string) => {
  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();

  return timingSafeEqual(actualHash, expectedHash);
};

const getSessionTtlSeconds = (auth: QueuedashAuthOptions): number => {
  const configured = auth.session?.ttlSeconds;
  if (configured === undefined) return DEFAULT_SESSION_TTL_SECONDS;
  if (!Number.isFinite(configured)) return DEFAULT_SESSION_TTL_SECONDS;

  return Math.min(
    Math.max(Math.round(configured), MIN_SESSION_TTL_SECONDS),
    MAX_SESSION_TTL_SECONDS,
  );
};

const getSessionSecret = (auth: QueuedashAuthOptions): Buffer => {
  const configured = auth.session?.secret;
  if (configured) return Buffer.from(configured);

  const existing = processSessionSecrets.get(auth);
  if (existing) return existing;

  const generated = randomBytes(32);
  processSessionSecrets.set(auth, generated);
  return generated;
};

const getSessionSigningKey = (auth: QueuedashAuthOptions): Buffer =>
  createHash("sha256")
    .update("queuedash-session-v1\0")
    .update(getSessionSecret(auth))
    .update("\0")
    .update(auth.username)
    .update("\0")
    .update(auth.password)
    .digest();

const signSessionPayload = (
  payload: string,
  auth: QueuedashAuthOptions,
): string =>
  createHmac("sha256", getSessionSigningKey(auth))
    .update(payload)
    .digest("base64url");

const normalizeCookiePath = (baseUrl: string): string => {
  const path = `/${baseUrl}`.replace(/\/+/g, "/").replace(/\/$/, "");
  return path || "/";
};

const getCookie = (
  cookieHeader: string | null | undefined,
  name: string,
): string | undefined => {
  for (const entry of cookieHeader?.split(";") ?? []) {
    const separator = entry.indexOf("=");
    if (separator === -1) continue;
    if (entry.slice(0, separator).trim() !== name) continue;
    return entry.slice(separator + 1).trim();
  }

  return undefined;
};

export const getQueuedashAuthMode = (
  auth: QueuedashAuthOptions | undefined,
): QueuedashAuthMode | undefined => {
  if (!auth) return undefined;
  if (auth.mode === undefined || auth.mode === "session") return "session";
  if (auth.mode === "basic") return "basic";

  throw new Error('Queuedash auth mode must be either "session" or "basic"');
};

/**
 * Checks `auth` once, when an adapter is created. Configuration read from
 * environment variables, JSON, or YAML is untyped: a mode of "Session" or a
 * numeric password would otherwise throw on every request instead, which is a
 * 500 on most frameworks and an unhandled rejection that ends the process on
 * Express 4.
 */
export const validateQueuedashAuthOptions = (
  auth: QueuedashAuthOptions | undefined,
): QueuedashAuthMode | undefined => {
  if (!auth) return undefined;

  for (const field of ["username", "password"] as const) {
    const value: unknown = auth[field];
    if (typeof value !== "string" || value === "") {
      throw new Error(`Queuedash auth.${field} must be a non-empty string`);
    }
  }
  const secret: unknown = auth.session?.secret;
  if (secret !== undefined && typeof secret !== "string") {
    throw new Error("Queuedash auth.session.secret must be a string");
  }

  return getQueuedashAuthMode(auth);
};

export const isQueuedashBasicAuthorized = (
  authorization: string | null | undefined,
  auth: QueuedashAuthOptions | undefined,
) => {
  if (!auth) return true;
  if (!auth.username || !auth.password) return false;

  const match = authorization?.trim().match(/^Basic\s+([^\s]+)$/i);
  if (!match) return false;

  try {
    const credentials = Buffer.from(match[1], "base64").toString("utf8");
    return safeEqual(credentials, `${auth.username}:${auth.password}`);
  } catch {
    return false;
  }
};

/** @deprecated Use isQueuedashBasicAuthorized instead. */
export const isQueueDashAuthorized = isQueuedashBasicAuthorized;

export const createQueuedashSessionToken = (
  auth: QueuedashAuthOptions,
  now = Date.now(),
): string => {
  const payload = Buffer.from(
    JSON.stringify({
      expiresAt: now + getSessionTtlSeconds(auth) * 1_000,
      nonce: randomBytes(16).toString("base64url"),
      version: SESSION_TOKEN_VERSION,
    }),
  ).toString("base64url");

  return `${payload}.${signSessionPayload(payload, auth)}`;
};

export const isQueuedashSessionAuthorized = (
  cookieHeader: string | null | undefined,
  auth: QueuedashAuthOptions | undefined,
  now = Date.now(),
): boolean => {
  if (!auth) return true;
  if (!auth.username || !auth.password) return false;

  const token = getCookie(cookieHeader, QUEUEDASH_SESSION_COOKIE);
  if (!token) return false;

  const separator = token.indexOf(".");
  if (separator === -1) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, signSessionPayload(payload, auth))) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      expiresAt?: unknown;
      version?: unknown;
    };

    return (
      parsed.version === SESSION_TOKEN_VERSION &&
      typeof parsed.expiresAt === "number" &&
      Number.isFinite(parsed.expiresAt) &&
      parsed.expiresAt > now
    );
  } catch {
    return false;
  }
};

export const createQueuedashSessionCookie = ({
  auth,
  baseUrl,
  requestIsSecure,
}: {
  auth: QueuedashAuthOptions;
  baseUrl: string;
  requestIsSecure: boolean;
}): string => {
  const secure = auth.session?.secure ?? requestIsSecure;
  const attributes = [
    `${QUEUEDASH_SESSION_COOKIE}=${createQueuedashSessionToken(auth)}`,
    `Path=${normalizeCookiePath(baseUrl)}`,
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${getSessionTtlSeconds(auth)}`,
  ];
  if (secure) attributes.push("Secure");

  return attributes.join("; ");
};

export const createQueuedashExpiredSessionCookie = (baseUrl: string): string =>
  [
    `${QUEUEDASH_SESSION_COOKIE}=`,
    `Path=${normalizeCookiePath(baseUrl)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ].join("; ");

/**
 * What a request beneath the dashboard's base path is for. The adapters
 * classify requests here rather than in their own routers, so that all four
 * answer every path the same way.
 */
export type QueuedashRoute =
  | "app"
  | "trpc"
  | "auth-session"
  | "auth-login"
  | "auth-logout"
  | "not-found";

const isWithinPath = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

/**
 * `path` is relative to the base path, such as "/trpc/queue.list". Nothing
 * under "/trpc" or "/auth" falls through to the dashboard shell.
 */
export const getQueuedashRoute = (
  method: string,
  path: string,
): QueuedashRoute => {
  const isRead = method === "GET" || method === "HEAD";
  if (isWithinPath(path, "/trpc")) return "trpc";
  if (isWithinPath(path, "/auth")) {
    if (path === "/auth/session" && isRead) return "auth-session";
    if (path === "/auth/login" && method === "POST") return "auth-login";
    if (path === "/auth/logout" && method === "POST") return "auth-logout";
    return "not-found";
  }

  return isRead ? "app" : "not-found";
};

/** A response the adapter sends exactly as described. */
export type QueuedashResponse = {
  type: "respond";
  status: number;
  headers: Record<string, string>;
  body?: string;
};

export type QueuedashRequestDecision =
  /** Serve the dashboard's HTML shell. */
  | { type: "app" }
  /** Hand the request to tRPC and add `headers` to its response. */
  | { type: "trpc"; headers: Record<string, string> }
  | QueuedashResponse;

const respond = (
  status: number,
  body?: string,
  headers: Record<string, string> = {},
): QueuedashResponse => ({
  type: "respond",
  status,
  headers: {
    // Each of these answers depends on the request's credentials.
    "Cache-Control": "no-store",
    ...(body === undefined
      ? {}
      : { "Content-Type": "text/plain; charset=utf-8" }),
    ...headers,
  },
  body,
});

const notFound = (): QueuedashResponse => respond(404, "Not found");

const unauthorized = ({ challenge = false } = {}): QueuedashResponse =>
  respond(
    401,
    QUEUEDASH_AUTH_REQUIRED_MESSAGE,
    challenge ? { "WWW-Authenticate": QUEUEDASH_AUTH_CHALLENGE } : {},
  );

const isJsonContentType = (contentType: string | null | undefined): boolean =>
  contentType?.split(";")[0].trim().toLowerCase() === "application/json";

const isNonJsonPost = (
  method: string,
  contentType: string | null | undefined,
): boolean => method === "POST" && !isJsonContentType(contentType);

const unsupportedMediaType = (): QueuedashResponse =>
  respond(415, "Content-Type must be application/json");

/**
 * The one auth decision every adapter applies. Basic mode challenges every
 * path; session mode leaves the shell public so the login screen can render,
 * and requires a session for tRPC.
 */
export const resolveQueuedashRequest = (
  auth: QueuedashAuthOptions | undefined,
  request: {
    route: QueuedashRoute;
    method: string;
    authorization: string | null | undefined;
    cookie: string | null | undefined;
    contentType: string | null | undefined;
    /** The dashboard's full mount path, which scopes the session cookie. */
    baseUrl: string;
    isSecure: boolean;
  },
): QueuedashRequestDecision => {
  const mode = getQueuedashAuthMode(auth);
  if (
    mode === "basic" &&
    !isQueuedashBasicAuthorized(request.authorization, auth)
  ) {
    return unauthorized({ challenge: true });
  }

  switch (request.route) {
    case "app":
      return { type: "app" };
    case "trpc":
      if (
        mode === "session" &&
        !isQueuedashSessionAuthorized(request.cookie, auth)
      ) {
        return unauthorized();
      }
      // tRPC also runs multipart/form-data POSTs as mutations. A form on
      // another site can send one without a CORS preflight, along with any
      // Basic credentials the browser has cached, so an input-less mutation
      // such as queue.pauseAll would run cross-site. The dashboard only sends
      // JSON, and a JSON POST from another origin must pass a preflight.
      if (isNonJsonPost(request.method, request.contentType)) {
        return unsupportedMediaType();
      }
      return {
        type: "trpc",
        headers: { "Cache-Control": "private, no-store" },
      };
    case "auth-session":
      if (mode !== "session") return notFound();
      return isQueuedashSessionAuthorized(request.cookie, auth)
        ? respond(204)
        : unauthorized();
    case "auth-login":
      if (mode !== "session" || !auth) return notFound();
      if (!isQueuedashBasicAuthorized(request.authorization, auth)) {
        return unauthorized();
      }
      return respond(204, undefined, {
        "Set-Cookie": createQueuedashSessionCookie({
          auth,
          baseUrl: request.baseUrl,
          requestIsSecure: request.isSecure,
        }),
      });
    case "auth-logout":
      if (mode !== "session") return notFound();
      return respond(204, undefined, {
        "Set-Cookie": createQueuedashExpiredSessionCookie(request.baseUrl),
      });
    case "not-found":
      return notFound();
  }
};

export const createQueuedashUnauthorizedResponse = ({
  challenge = false,
}: { challenge?: boolean } = {}) => {
  const { status, headers, body } = unauthorized({ challenge });
  return new Response(body, { status, headers });
};

/** @deprecated Use createQueuedashUnauthorizedResponse instead. */
export const createQueueDashUnauthorizedResponse = () =>
  createQueuedashUnauthorizedResponse({ challenge: true });

/**
 * For a tRPC handler you serve yourself, such as a Next.js route: the 415 the
 * built-in adapters send for a POST that isn't application/json, or undefined
 * when the request can go on to tRPC. tRPC also runs mutations posted as
 * multipart/form-data, which a plain form on another website can send.
 */
export const rejectNonJsonPost = (request: Request): Response | undefined => {
  if (!isNonJsonPost(request.method, request.headers.get("Content-Type"))) {
    return undefined;
  }
  const { status, headers, body } = unsupportedMediaType();
  return new Response(body, { status, headers });
};
