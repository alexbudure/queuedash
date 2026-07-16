import { createHash, timingSafeEqual } from "node:crypto";

export type QueueDashAuthOptions = {
  username: string;
  password: string;
};

export const QUEUEDASH_AUTH_CHALLENGE =
  'Basic realm="QueueDash", charset="UTF-8"';
export const QUEUEDASH_AUTH_REQUIRED_MESSAGE = "Authentication required";

const safeEqual = (actual: string, expected: string) => {
  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();

  return timingSafeEqual(actualHash, expectedHash);
};

export const isQueueDashAuthorized = (
  authorization: string | null | undefined,
  auth: QueueDashAuthOptions | undefined,
) => {
  if (!auth) {
    return true;
  }

  if (!auth.username || !auth.password) {
    return false;
  }

  const match = authorization?.trim().match(/^Basic\s+([^\s]+)$/i);
  if (!match) {
    return false;
  }

  const credentials = Buffer.from(match[1], "base64").toString("utf8");
  return safeEqual(credentials, `${auth.username}:${auth.password}`);
};

export const createQueueDashUnauthorizedResponse = () =>
  new Response(QUEUEDASH_AUTH_REQUIRED_MESSAGE, {
    status: 401,
    headers: {
      "WWW-Authenticate": QUEUEDASH_AUTH_CHALLENGE,
      "Cache-Control": "no-store",
    },
  });
