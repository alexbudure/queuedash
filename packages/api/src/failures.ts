import { createHash } from "node:crypto";

import type { AdaptedJob } from "./queue-adapters/base.adapter";

/**
 * What a failure looks like once the parts that vary between jobs are masked:
 * three thousand "Order 4812 not found" failures are one problem, not three
 * thousand. The fingerprint names the group in URLs and filters.
 */
export type FailureSignature = {
  fingerprint: string;
  // The error class from the stack or message, e.g. "TypeError".
  type: string | null;
  // The message's first line with variable parts replaced by ‹kind› markers.
  message: string;
  // The first stack frame in the application's own code, for display.
  frame: string | null;
};

const MAX_MESSAGE_LENGTH = 300;

const placeholder = (kind: string) => `‹${kind}›`;

// An identifier in quotes is usually code: the property a TypeError could not
// read, the field a validator rejected. Anything else in quotes is data.
const QUOTED_IDENTIFIER = /^[A-Za-z_$][\w$.-]{0,40}$/u;

// HTTP and SMTP status codes tell failures apart ("421 Service not
// available" is not "550 Mailbox unavailable"); other numbers are ids,
// durations and counts that only split one failure into many groups.
const isStatusCode = (text: string) =>
  /^\d{3}$/u.test(text) && Number(text) >= 100 && Number(text) <= 599;

export const maskFailureMessage = (text: string): string => {
  const firstLine = text.split(/\r?\n/u, 1)[0] ?? "";
  return (
    firstLine
      .replaceAll(/\bhttps?:\/\/[^\s'"<>)]+/giu, placeholder("url"))
      .replaceAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu, placeholder("email"))
      .replaceAll(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,
        placeholder("id"),
      )
      .replaceAll(
        /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/gu,
        placeholder("time"),
      )
      .replaceAll(
        /(["'`])((?:(?!\1)[^\\\n]|\\.){0,200})\1/gu,
        (match, _q, inner) =>
          QUOTED_IDENTIFIER.test(inner) && !/\d/u.test(inner)
            ? match
            : placeholder("str"),
      )
      .replaceAll(/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/giu, placeholder("id"))
      // "1920x1080" as one value, not a masked width beside a literal height.
      .replaceAll(/\b\d+(?:x\d+)+\b/gu, placeholder("size"))
      .replaceAll(/(?<![\w.‹])\d+(?:\.\d+)?(?![\d.])/gu, (match) =>
        isStatusCode(match) ? match : placeholder("num"),
      )
      .replaceAll(/\s+/gu, " ")
      .trim()
      .slice(0, MAX_MESSAGE_LENGTH)
  );
};

// "Error", "TypeError", "SmtpError", "TimeoutException", with Node's optional
// code in brackets: "Error [ERR_HTTP2_STREAM_ERROR]: ...".
const ERROR_TYPE =
  /^\s*((?:[A-Za-z_$][\w$]*)?(?:Error|Exception))\b(?:\s*\[[^\]]*\])?\s*:\s*/u;

const readErrorType = (line: string | undefined) =>
  line ? (ERROR_TYPE.exec(line)?.[1] ?? null) : null;

const STACK_FRAME = /^\s*at\s+(?:(.+?)\s+\()?(.+?):\d+:\d+\)?\s*$/u;

const isLibraryFrame = (file: string) =>
  file.includes("node_modules") ||
  file.startsWith("node:") ||
  file.startsWith("internal/") ||
  file === "<anonymous>" ||
  file === "native";

const shortenPath = (file: string) => {
  const parts = file.replace(/^file:\/\//u, "").split(/[\\/]/u);
  return parts.slice(-3).join("/");
};

const readAppFrame = (stack: string): { key: string; label: string } | null => {
  for (const line of stack.split(/\r?\n/u).slice(1)) {
    const match = STACK_FRAME.exec(line);
    if (!match) continue;
    const file = (match[2] ?? "").replace(/^file:\/\//u, "");
    if (isLibraryFrame(file)) continue;
    const fn = (match[1] ?? "")
      .replace(/^async\s+/u, "")
      .replace(/\s+\[as [^\]]+\]$/u, "")
      .trim();
    const path = shortenPath(file);
    // The line number is left out on purpose: it moves with every deploy,
    // and a group should not split in two when it does.
    return {
      key: `${file}#${fn}`,
      label: fn && fn !== "<anonymous>" ? `${path} › ${fn}` : path,
    };
  }
  return null;
};

// The stack of the attempt the reason describes. Libraries keep one stack per
// failed attempt, in either order, so the right one is the stack that starts
// with the reason; failing that, the newest by BullMQ's order.
const pickLatestStack = (job: AdaptedJob): string | undefined => {
  const stacks = job.stacktrace?.filter(
    (stack): stack is string => typeof stack === "string" && stack.length > 0,
  );
  if (!stacks?.length) return undefined;
  const reason = job.failedReason?.split(/\r?\n/u, 1)[0]?.trim();
  if (reason) {
    const matching = stacks.find((stack) =>
      stack.split(/\r?\n/u, 1)[0]?.includes(reason),
    );
    if (matching) return matching;
  }
  return stacks.at(-1);
};

/**
 * The signature of a job's latest failure, read from the job as the viewer is
 * allowed to see it: redaction and hidden stack traces apply first, so two
 * viewers with different privacy settings may group differently, but never
 * by text they could not see.
 */
export const getFailureSignature = (
  job: AdaptedJob,
): FailureSignature | null => {
  const reason = job.failedReason?.trim();
  const stack = pickLatestStack(job);
  if (!reason && !stack) return null;

  const stackHead = stack?.split(/\r?\n/u, 1)[0];
  const reasonHead = reason?.split(/\r?\n/u, 1)[0];
  const type = readErrorType(stackHead) ?? readErrorType(reasonHead);
  // A reason is usually the bare message; a stack's first line is
  // "Type: message". Either way the type is shown on its own.
  const rawMessage = (reasonHead ?? stackHead ?? "").replace(ERROR_TYPE, "");
  const message = maskFailureMessage(rawMessage);
  const frame = stack ? readAppFrame(stack) : null;

  const fingerprint = createHash("sha256")
    .update([type ?? "", message, frame?.key ?? ""].join("\u0000"))
    .digest("hex")
    .slice(0, 16);

  return { fingerprint, type, message, frame: frame?.label ?? null };
};
