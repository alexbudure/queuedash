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

export const isQueuedashRequestAuthorized = ({
  auth,
  authorization,
  cookie,
}: {
  auth: QueuedashAuthOptions | undefined;
  authorization?: string | null;
  cookie?: string | null;
}): boolean => {
  const mode = getQueuedashAuthMode(auth);
  if (!mode) return true;

  return mode === "basic"
    ? isQueuedashBasicAuthorized(authorization, auth)
    : isQueuedashSessionAuthorized(cookie, auth);
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

export const createQueuedashUnauthorizedResponse = ({
  challenge = false,
}: { challenge?: boolean } = {}) => {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
  });
  if (challenge) headers.set("WWW-Authenticate", QUEUEDASH_AUTH_CHALLENGE);

  return new Response(QUEUEDASH_AUTH_REQUIRED_MESSAGE, {
    status: 401,
    headers,
  });
};

/** @deprecated Use createQueuedashUnauthorizedResponse instead. */
export const createQueueDashUnauthorizedResponse = () =>
  createQueuedashUnauthorizedResponse({ challenge: true });
