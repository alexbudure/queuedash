/**
 * Reading a stored stack trace: which error, and which frames are the app's own.
 * The API's error signatures (packages/api/src/failures.ts) read stacks the same
 * way, so the frame the panel leads with is the one the Errors tab groups by.
 */

export type StackFrame = {
  /** The function, or null for code that runs outside one. */
  fn: string | null;
  /** The location as the worker reported it, `file://` removed. */
  path: string;
  line: number | null;
  column: number | null;
  /** Code in a dependency or in Node, not in the app. */
  isLibrary: boolean;
  /** The package a library frame is in (`stripe`, `@aws-sdk/client-s3`), or
   *  `node` for Node's own. */
  pkg: string | null;
  /** The path shortened for display: the last three segments of app code, a
   *  dependency's path from its package, or Node's module. */
  label: string;
};

export type ParsedStack = {
  raw: string;
  /** `StripeCardError`, `TypeError`; null when the header names none. */
  type: string | null;
  message: string;
  frames: StackFrame[];
};

const ERROR_TYPE =
  /^\s*((?:[A-Za-z_$][\w$]*)?(?:Error|Exception))\b(?:\s*\[[^\]]*\])?\s*:\s*/;
const BARE_ERROR_TYPE = /^\s*([A-Za-z_$][\w$]*(?:Error|Exception))\s*$/;
const FRAME_LINE = /^\s*at\s/;
const FRAME = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
// `at new Promise (<anonymous>)`, `at Array.forEach (native)`
const FRAME_WITHOUT_POSITION = /^\s*at\s+(?:(.+?)\s+\()?([^()]+?)\)?\s*$/;

const isLibraryPath = (path: string) =>
  path.includes("/node_modules/") ||
  path.startsWith("node:") ||
  path.startsWith("internal/") ||
  path === "<anonymous>" ||
  path === "native";

const readPackage = (path: string): string | null => {
  if (path.startsWith("node:") || path.startsWith("internal/")) return "node";
  const index = path.lastIndexOf("/node_modules/");
  if (index === -1) return null;
  const [first, second] = path
    .slice(index + "/node_modules/".length)
    .split("/");
  if (!first) return null;
  return first.startsWith("@") && second ? `${first}/${second}` : first;
};

const toLabel = (path: string, isLibrary: boolean): string => {
  if (isLibrary) {
    const index = path.lastIndexOf("/node_modules/");
    return index === -1 ? path : path.slice(index + "/node_modules/".length);
  }
  const segments = path.split("/").filter(Boolean);
  return segments.slice(-3).join("/");
};

const toPath = (location: string) => {
  const withoutScheme = location.startsWith("file://")
    ? safeDecode(location.slice("file://".length))
    : location;
  // Windows paths use backslashes; every consumer here wants forward slashes.
  return withoutScheme.replaceAll("\\", "/");
};

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const toFrame = (
  fn: string | undefined,
  location: string,
  line: number | null,
  column: number | null,
): StackFrame => {
  const path = toPath(location);
  const isLibrary = isLibraryPath(path);
  return {
    fn: fn?.replace(/^async\s+/, "") || null,
    path,
    line,
    column,
    isLibrary,
    pkg: isLibrary ? readPackage(path) : null,
    label: toLabel(path, isLibrary),
  };
};

export const parseStack = (raw: string): ParsedStack => {
  const lines = raw.split(/\r?\n/);
  const firstFrame = lines.findIndex((line) => FRAME_LINE.test(line));
  const header = (firstFrame === -1 ? lines : lines.slice(0, firstFrame))
    .join("\n")
    .trim();

  const typed = ERROR_TYPE.exec(header);
  const bare = typed ? null : BARE_ERROR_TYPE.exec(header);
  const type = typed?.[1] ?? bare?.[1] ?? null;
  const message = typed
    ? header.slice(typed[0].length).trim()
    : bare
      ? ""
      : header;

  const frames: StackFrame[] = [];
  for (const line of firstFrame === -1 ? [] : lines.slice(firstFrame)) {
    const positioned = FRAME.exec(line);
    if (positioned) {
      frames.push(
        toFrame(
          positioned[1],
          positioned[2] ?? "",
          Number(positioned[3]),
          Number(positioned[4]),
        ),
      );
      continue;
    }
    const unpositioned = FRAME_WITHOUT_POSITION.exec(line);
    if (unpositioned) {
      frames.push(toFrame(unpositioned[1], unpositioned[2] ?? "", null, null));
    }
  }

  return { raw, type, message, frames };
};

/** Where the error came from in the app's own code, when any frame is. */
export const getAppFrame = (stack: ParsedStack): StackFrame | null =>
  stack.frames.find((frame) => !frame.isLibrary) ?? null;

export type StackRow =
  | { kind: "frame"; frame: StackFrame; index: number }
  | { kind: "library"; frames: StackFrame[]; pkgs: string[]; index: number };

/** Frames in order, each run of library frames folded into one row. */
export const groupStackRows = (frames: StackFrame[]): StackRow[] => {
  const rows: StackRow[] = [];
  frames.forEach((frame, index) => {
    if (!frame.isLibrary) {
      rows.push({ kind: "frame", frame, index });
      return;
    }
    const previous = rows.at(-1);
    if (previous?.kind === "library") {
      previous.frames.push(frame);
      if (frame.pkg && !previous.pkgs.includes(frame.pkg)) {
        previous.pkgs.push(frame.pkg);
      }
      return;
    }
    rows.push({
      kind: "library",
      frames: [frame],
      pkgs: frame.pkg ? [frame.pkg] : [],
      index,
    });
  });
  return rows;
};

export type Attempt = {
  /** The attempt this stack came from, or null where that can't be told. */
  number: number | null;
  stack: ParsedStack;
  /** Failed the same way as the newest attempt: same error, same place. */
  isSameAsLatest: boolean;
};

const isSameFailure = (left: ParsedStack, right: ParsedStack) => {
  const leftFrame = getAppFrame(left);
  const rightFrame = getAppFrame(right);
  return (
    left.type === right.type &&
    left.message === right.message &&
    leftFrame?.path === rightFrame?.path &&
    leftFrame?.fn === rightFrame?.fn
  );
};

/**
 * The failed attempts a job kept a trace of, newest first. Stacks are stored
 * oldest first, one per failed attempt, but a library may keep only the last
 * few (`stackTraceLimit`, GroupMQ's single trace). A job that failed for good
 * has made exactly as many attempts as failed, so its newest stack is attempt
 * `attemptsMade` whatever was dropped; otherwise the count of stacks numbers
 * them, unless some may be missing.
 */
export const getAttempts = (
  stacktrace: readonly string[],
  {
    attemptsMade,
    hasFailed,
    stackTraceLimit,
  }: {
    attemptsMade: number | null;
    hasFailed: boolean;
    stackTraceLimit: number | null;
  },
): Attempt[] => {
  const stacks = stacktrace
    .filter((stack) => typeof stack === "string" && stack.trim().length > 0)
    .map(parseStack);
  if (stacks.length === 0) return [];

  const count = stacks.length;
  const mayBeMissing = stackTraceLimit !== null && count >= stackTraceLimit;
  const newestNumber =
    hasFailed && attemptsMade !== null && attemptsMade >= count
      ? attemptsMade
      : mayBeMissing
        ? null
        : count;

  const latest = stacks[count - 1] as ParsedStack;
  return stacks
    .map((stack, index) => ({
      number: newestNumber === null ? null : newestNumber - (count - 1 - index),
      stack,
      isSameAsLatest: index !== count - 1 && isSameFailure(stack, latest),
    }))
    .reverse();
};
