import { createHmac, randomBytes } from "node:crypto";

import type { AdaptedJob, SchedulerInfo } from "./queue-adapters/base.adapter";
import type { QueuedashPrivacyConfig, QueuedashRedactionConfig } from "./trpc";

const DEFAULT_REDACTED_KEYS = [
  "accessToken",
  "apiKey",
  "authorization",
  "clientSecret",
  "cookie",
  "creditCard",
  "password",
  "privateKey",
  "proxyAuthorization",
  "refreshToken",
  "secret",
  "session",
  "sessionId",
  "setCookie",
  "ssn",
  "token",
  "xApiKey",
];
const DEFAULT_REPLACEMENT = "[REDACTED]";
const MAX_ENCODED_JSON_DEPTH = 5;
const MAX_JSON_FRAGMENT_PARSE_MULTIPLIER = 4;
const MAX_TEXT_NESTING_DEPTH = 5;

type ResolvedRedactionConfig = {
  keys: Set<string>;
  paths: string[][];
  replacement: string;
};

export type ResolvedPrivacyExposure = {
  jobData: boolean;
  jobOptions: boolean;
  logs: boolean;
  returnValues: boolean;
  schedulerData: boolean;
  stacktraces: boolean;
};

export const resolvePrivacyExposure = (
  privacy?: QueuedashPrivacyConfig,
): ResolvedPrivacyExposure => ({
  jobData: privacy?.expose?.jobData !== false,
  jobOptions: privacy?.expose?.jobOptions !== false,
  logs: privacy?.expose?.logs !== false,
  returnValues: privacy?.expose?.returnValues !== false,
  schedulerData: privacy?.expose?.schedulerData !== false,
  stacktraces: privacy?.expose?.stacktraces !== false,
});

const normalizeKey = (value: string): string =>
  value.toLocaleLowerCase().replaceAll(/[^a-z0-9]/g, "");

const resolveRedaction = (
  privacy?: QueuedashPrivacyConfig,
): ResolvedRedactionConfig | null => {
  if (!privacy?.redact) return null;

  const config: QueuedashRedactionConfig =
    privacy.redact === true ? {} : privacy.redact;
  const keys = [
    ...(config.includeDefaultKeys === false ? [] : DEFAULT_REDACTED_KEYS),
    ...(config.keys ?? []),
  ];

  return {
    keys: new Set(keys.map(normalizeKey)),
    paths: (config.paths ?? [])
      .map((path) => path.split(".").filter(Boolean))
      .filter((path) => path.length > 0),
    replacement: config.replacement ?? DEFAULT_REPLACEMENT,
  };
};

const matchesPath = (path: string[], pattern: string[]): boolean =>
  path.length === pattern.length &&
  pattern.every((part, index) => part === "*" || part === path[index]);

const shouldRedact = (
  key: string,
  path: string[],
  config: ResolvedRedactionConfig,
): boolean =>
  config.keys.has(normalizeKey(key)) ||
  config.paths.some((pattern) => matchesPath(path, pattern));

export const privacyRedactsPath = (
  privacy: QueuedashPrivacyConfig | undefined,
  path: string[],
): boolean => {
  const config = resolveRedaction(privacy);
  const key = path.at(-1);
  return Boolean(config && key && shouldRedact(key, path, config));
};

export const privacyRedactsGroupIdentity = (
  privacy?: QueuedashPrivacyConfig,
): boolean => {
  const config = resolveRedaction(privacy);
  if (!config) return false;
  if (shouldRedact("groupId", ["groupId"], config)) return true;
  if (config.keys.has(normalizeKey("id"))) return true;
  return config.paths.some(
    (pattern) =>
      pattern.length === 2 &&
      (pattern[0] === "*" || /^\d+$/u.test(pattern[0] ?? "")) &&
      pattern[1] === "id",
  );
};

export const privacyRedactsJobIdentity = (
  privacy?: QueuedashPrivacyConfig,
): boolean => privacyRedactsPath(privacy, ["id"]);

const getTextKeyParts = (key: string): string[] =>
  (key.match(/[a-z0-9_.-]+/giu) ?? []).flatMap((part) => part.split("."));

const isSensitiveTextKey = (
  key: string,
  config: ResolvedRedactionConfig,
): boolean => {
  const keyParts = getTextKeyParts(key);
  return (
    config.keys.has(normalizeKey(key)) ||
    keyParts.some((part) => config.keys.has(normalizeKey(part)))
  );
};

const OPAQUE_HEADER_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
]);

const isOpaqueHeaderKey = (key: string): boolean =>
  getTextKeyParts(key).some((part) =>
    OPAQUE_HEADER_KEYS.has(normalizeKey(part)),
  );

const redactEncodedJsonString = (
  value: string,
  config: ResolvedRedactionConfig,
  path: string[],
  seen: WeakSet<object>,
  encodedJsonDepth: number,
): string => {
  const leadingWhitespace = value.match(/^\s*/u)?.[0] ?? "";
  // trimEnd strips exactly `\s`. An unanchored /\s*$/ restarted at every
  // blank of an inner whitespace run and rescanned the rest of it.
  const trailingWhitespace = value.slice(value.trimEnd().length);
  const candidate = value.slice(
    leadingWhitespace.length,
    value.length - trailingWhitespace.length,
  );
  if (!candidate || !['"', "{", "["].includes(candidate[0] ?? "")) {
    return value;
  }
  if (encodedJsonDepth >= MAX_ENCODED_JSON_DEPTH) {
    return `${leadingWhitespace}${config.replacement}${trailingWhitespace}`;
  }

  try {
    const parsed: unknown = JSON.parse(candidate);
    if (typeof parsed === "string") {
      const redacted = redactEncodedJsonString(
        parsed,
        config,
        path,
        seen,
        encodedJsonDepth + 1,
      );
      return redacted === parsed
        ? value
        : `${leadingWhitespace}${JSON.stringify(redacted)}${trailingWhitespace}`;
    }
    if (!parsed || typeof parsed !== "object") return value;

    const original = JSON.stringify(parsed);
    const redacted = JSON.stringify(
      redactValueWithConfig(parsed, config, path, seen, encodedJsonDepth + 1),
    );
    return redacted === original
      ? value
      : `${leadingWhitespace}${redacted}${trailingWhitespace}`;
  } catch {
    return value;
  }
};

const redactValueWithConfig = (
  value: unknown,
  config: ResolvedRedactionConfig,
  path: string[] = [],
  seen = new WeakSet<object>(),
  encodedJsonDepth = 0,
): unknown => {
  if (typeof value === "string") {
    return redactTextWithConfig(
      redactEncodedJsonString(value, config, path, seen, encodedJsonDepth),
      config,
      0,
    );
  }
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) return value;
  if (seen.has(value)) return config.replacement;

  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const key = String(index);
      const childPath = [...path, key];
      return shouldRedact(key, childPath, config)
        ? config.replacement
        : redactValueWithConfig(
            item,
            config,
            childPath,
            seen,
            encodedJsonDepth,
          );
    });
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => {
      const childPath = [...path, key];
      return [
        key,
        shouldRedact(key, childPath, config)
          ? config.replacement
          : redactValueWithConfig(
              child,
              config,
              childPath,
              seen,
              encodedJsonDepth,
            ),
      ];
    }),
  );
};

export const redactValue = (
  value: unknown,
  privacy?: QueuedashPrivacyConfig,
): unknown => {
  const config = resolveRedaction(privacy);
  return config ? redactValueWithConfig(value, config) : value;
};

type JsonFragmentNode = {
  children: JsonFragmentNode[];
  end?: number;
  expectedCloser: "}" | "]";
  start: number;
};

const findJsonFragmentNodes = (value: string): JsonFragmentNode[] => {
  const roots: JsonFragmentNode[] = [];
  const stack: JsonFragmentNode[] = [];
  let escaped = false;
  let insideString = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (insideString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        insideString = false;
      }
      continue;
    }

    if (character === '"' && stack.length > 0) {
      insideString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      const node: JsonFragmentNode = {
        children: [],
        expectedCloser: character === "{" ? "}" : "]",
        start: index,
      };
      const parent = stack.at(-1);
      if (parent) parent.children.push(node);
      else roots.push(node);
      stack.push(node);
      continue;
    }
    if (character !== "}" && character !== "]") continue;

    const current = stack.at(-1);
    if (!current || current.expectedCloser !== character) {
      stack.length = 0;
      insideString = false;
      escaped = false;
      continue;
    }

    current.end = index;
    stack.pop();
  }

  return roots;
};

const redactJsonFragments = (
  value: string,
  config: ResolvedRedactionConfig,
): string => {
  const replacements: { end: number; replacement: string; start: number }[] =
    [];
  let parseBudget = Math.max(
    value.length * MAX_JSON_FRAGMENT_PARSE_MULTIPLIER,
    1_024,
  );

  const pending = findJsonFragmentNodes(value).reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    let handled = false;
    if (node.end !== undefined) {
      const length = node.end - node.start + 1;
      if (length > parseBudget) {
        replacements.push({
          end: node.end,
          replacement: config.replacement,
          start: node.start,
        });
        handled = true;
      } else {
        parseBudget -= length;
        try {
          const parsed: unknown = JSON.parse(
            value.slice(node.start, node.end + 1),
          );
          if (parsed && typeof parsed === "object") {
            const original = JSON.stringify(parsed);
            const replacement = JSON.stringify(
              redactValueWithConfig(parsed, config),
            );
            if (replacement !== original) {
              replacements.push({
                end: node.end,
                replacement,
                start: node.start,
              });
            }
            handled = true;
          }
        } catch {
          // Invalid containers can still contain valid JSON children.
        }
      }
    }

    if (!handled) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index];
        if (child) pending.push(child);
      }
    }
  }
  if (replacements.length === 0) return value;

  let cursor = 0;
  let redacted = "";
  for (const { end, replacement, start } of replacements.sort(
    (left, right) => left.start - right.start,
  )) {
    if (start < cursor) continue;
    redacted += value.slice(cursor, start) + replacement;
    cursor = end + 1;
  }
  return redacted + value.slice(cursor);
};

const redactEncodedJsonStringsInText = (
  value: string,
  config: ResolvedRedactionConfig,
): string => {
  const replacements: { end: number; replacement: string; start: number }[] =
    [];
  let start: number | undefined;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (start === undefined) {
      if (character === '"') start = index;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character !== '"') continue;

    const raw = value.slice(start, index + 1);
    const replacement = redactEncodedJsonString(
      raw,
      config,
      [],
      new WeakSet<object>(),
      0,
    );
    if (replacement !== raw) {
      replacements.push({ end: index, replacement, start });
    }
    start = undefined;
  }

  if (replacements.length === 0) return value;
  let cursor = 0;
  let redacted = "";
  for (const replacement of replacements) {
    redacted +=
      value.slice(cursor, replacement.start) + replacement.replacement;
    cursor = replacement.end + 1;
  }
  return redacted + value.slice(cursor);
};

const findOpaqueHeaderEnd = (value: string, start: number): number => {
  let lineStart = start;
  while (lineStart < value.length) {
    const relativeLineEnd = value.slice(lineStart).search(/[\r\n]/u);
    if (relativeLineEnd === -1) return value.length;

    const lineEnd = lineStart + relativeLineEnd;
    const nextLineStart =
      value[lineEnd] === "\r" && value[lineEnd + 1] === "\n"
        ? lineEnd + 2
        : lineEnd + 1;
    if (!/[\t ]/u.test(value[nextLineStart] ?? "")) return lineEnd;
    lineStart = nextLineStart;
  }

  return value.length;
};

const findTextValueEnd = (
  value: string,
  start: number,
  key?: string,
): number => {
  if (key && isOpaqueHeaderKey(key)) {
    return findOpaqueHeaderEnd(value, start);
  }

  const first = value[start];
  const closer =
    first === '"'
      ? '"'
      : first === "'"
        ? "'"
        : first === "`"
          ? "`"
          : first === "("
            ? ")"
            : first === "["
              ? "]"
              : first === "{"
                ? "}"
                : undefined;
  if (closer) {
    const supportsNesting = first === "(" || first === "[" || first === "{";
    let escaped = false;
    let quote: '"' | "'" | "`" | undefined = supportsNesting
      ? undefined
      : (first as '"' | "'" | "`");
    const closerFor = (character: string): ")" | "]" | "}" | undefined =>
      character === "(" ? ")" : character === "[" ? "]" : "}";
    const closers = supportsNesting ? [closer] : [];
    for (let index = start + 1; index < value.length; index += 1) {
      const character = value[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (quote) {
        if (character === quote) {
          if (!supportsNesting) return index + 1;
          quote = undefined;
        }
        continue;
      }
      if (
        supportsNesting &&
        (character === '"' || character === "'" || character === "`")
      ) {
        quote = character;
        continue;
      }
      if (
        supportsNesting &&
        (character === "(" || character === "[" || character === "{")
      ) {
        closers.push(closerFor(character) as ")" | "]" | "}");
      } else if (
        supportsNesting &&
        (character === ")" || character === "]" || character === "}")
      ) {
        if (closers.at(-1) !== character) return value.length;
        closers.pop();
        if (closers.length === 0) return index + 1;
      }
    }
    return value.length;
  }

  const pemHeader = /^-----BEGIN ([A-Z0-9][A-Z0-9 ]*)-----/iu.exec(
    value.slice(start),
  );
  if (pemHeader) {
    const footer = `-----END ${pemHeader[1]}-----`;
    const footerStart = value.indexOf(footer, start + pemHeader[0].length);
    return footerStart === -1 ? value.length : footerStart + footer.length;
  }

  const parameterizedAuthorizationScheme = /(?:AWS4-HMAC-SHA256|Digest)\s+/iy;
  parameterizedAuthorizationScheme.lastIndex = start;
  if (parameterizedAuthorizationScheme.test(value)) {
    const lineEnd = value.slice(start).search(/[\r\n]/u);
    return lineEnd === -1 ? value.length : start + lineEnd;
  }

  const authorizationScheme = /(?:Bearer|Basic)\s+/iy;
  authorizationScheme.lastIndex = start;
  const schemeMatch = authorizationScheme.exec(value);
  if (schemeMatch) {
    let end = authorizationScheme.lastIndex;
    if (value[end] === '"' || value[end] === "'" || value[end] === "`") {
      return findTextValueEnd(value, end);
    }
    while (end < value.length && !/[\s}"'`\]]/u.test(value[end] ?? "")) {
      end += 1;
    }
    return end;
  }

  let end = start;
  const nextAssignment = /^(?:["']?)[a-z0-9_][a-z0-9_.-]*(?:["']?)\s*[:=]/iu;
  while (end < value.length) {
    const character = value[end] ?? "";
    if (/[\r\n]/u.test(character)) break;
    if (/\s/u.test(character)) {
      let next = end;
      while (next < value.length && /[\t ]/u.test(value[next] ?? "")) {
        next += 1;
      }
      if (nextAssignment.test(value.slice(next))) break;
      // Every blank of this run looks ahead to the same token; repeating the
      // check from each of them made long runs quadratic.
      end = Math.max(next, end + 1);
      continue;
    }
    end += 1;
  }
  return end;
};

const isSerializedReplacementJsonValue = (
  value: string,
  assignmentStart: number,
  valueEnd: number,
  keyQuote: string | undefined,
): boolean => {
  if (keyQuote !== '"') return false;

  let before = assignmentStart - 1;
  while (before >= 0 && /\s/u.test(value[before] ?? "")) before -= 1;
  if (value[before] !== "{" && value[before] !== ",") return false;

  let after = valueEnd;
  while (after < value.length && /\s/u.test(value[after] ?? "")) after += 1;
  if (value[after] === "}") return true;
  if (value[after] !== ",") return false;

  after += 1;
  while (after < value.length && /\s/u.test(value[after] ?? "")) after += 1;
  return /^"(?:\\.|[^"\\])*"\s*:/u.test(value.slice(after));
};

// The next `"key":` at or after `from`, exactly as a global search would find
// it. When the string at one quote is not a key, the escaped quotes inside it
// are not tried as starts: each would scan on to the same closing quote and
// fail the same way, which made text full of `\"` quadratic.
const findJsonKeyAssignment = (
  value: string,
  from: number,
): RegExpExecArray | null => {
  const assignment = /("(?:\\.|[^"\\])*")(\s*:\s*)/uy;
  const stringBody = /"(?:\\.|[^"\\])*/uy;
  for (let start = value.indexOf('"', from); start !== -1; ) {
    assignment.lastIndex = start;
    const match = assignment.exec(value);
    if (match) return match;

    stringBody.lastIndex = start;
    stringBody.exec(value);
    // A closing quote can open the next string; an unterminated scan stopped
    // at a line-breaking escape or the end, and so would every quote in it.
    start =
      value[stringBody.lastIndex] === '"'
        ? stringBody.lastIndex
        : value.indexOf('"', stringBody.lastIndex);
  }
  return null;
};

const redactJsonStringKeyAssignments = (
  value: string,
  config: ResolvedRedactionConfig,
): string => {
  let cursor = 0;
  let redacted = "";
  let searchFrom = 0;

  for (
    let match = findJsonKeyAssignment(value, searchFrom);
    match;
    match = findJsonKeyAssignment(value, searchFrom)
  ) {
    const valueStart = match.index + match[0].length;
    searchFrom = valueStart;
    const serializedKey = match[1];
    if (!serializedKey) continue;

    let key: unknown;
    try {
      key = JSON.parse(serializedKey);
    } catch {
      continue;
    }
    if (typeof key !== "string" || !isSensitiveTextKey(key, config)) continue;

    const serializedReplacement = JSON.stringify(config.replacement);
    const serializedReplacementEnd = valueStart + serializedReplacement.length;
    const valueEnd =
      value.startsWith(serializedReplacement, valueStart) &&
      isSerializedReplacementJsonValue(
        value,
        match.index,
        serializedReplacementEnd,
        '"',
      )
        ? serializedReplacementEnd
        : findTextValueEnd(value, valueStart, key);
    const rawValue = value.slice(valueStart, valueEnd);
    const first = rawValue[0];
    const last = rawValue.at(-1);
    const unwrappedValue =
      (first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === "`" && last === "`") ||
      (first === "(" && last === ")")
        ? rawValue.slice(1, -1)
        : rawValue;
    if (
      rawValue === config.replacement ||
      unwrappedValue === config.replacement
    ) {
      searchFrom = valueEnd;
      continue;
    }

    redacted += value.slice(cursor, match.index);
    redacted += serializedKey + (match[2] ?? ":") + config.replacement;
    cursor = valueEnd;
    searchFrom = valueEnd;
  }

  return cursor === 0 ? value : redacted + value.slice(cursor);
};

// The index after the key token that starts at `index`, or after the quote
// when `index` is an opening quote.
const skipTextKeyToken = (value: string, index: number): number => {
  if (value[index] === '"' || value[index] === "'") return index + 1;
  const token = /[a-z0-9_.-]*/iuy;
  token.lastIndex = index;
  token.exec(value);
  return token.lastIndex;
};

// Runs a sticky `key=`/`key:` pattern as a global search from `from` would,
// trying each key token once: from its first key character, or the quote
// before it. A start after a later dot or dash of `a.b-c` reaches the same
// separator and value, so it can only match where the token's first start
// already did, and that start's longer key is the one sensitivity is judged
// on. Retrying from every dot or dash made long tokens quadratic.
const findTextAssignment = (
  pattern: RegExp,
  value: string,
  from: number,
): RegExpExecArray | null => {
  const candidates = /["']|(?<![a-z0-9_])[a-z0-9_]/giu;
  candidates.lastIndex = from;
  for (
    let candidate = candidates.exec(value);
    candidate;
    candidate = candidates.exec(value)
  ) {
    pattern.lastIndex = candidate.index;
    const match = pattern.exec(value);
    if (match) return match;
    candidates.lastIndex = skipTextKeyToken(value, candidate.index);
  }
  return null;
};

const redactSensitiveAssignments = (
  value: string,
  config: ResolvedRedactionConfig,
): string => {
  // `(?:\s*\?\.)?\s*` rather than `\s*(?:\?\.)?\s*`: two adjacent `\s*` split
  // a whitespace run every possible way before failing.
  const assignmentStart =
    /(["']?)(?<![a-z0-9_])([a-z0-9_][a-z0-9_.-]*(?:(?:\s*\?\.)?\s*\[\s*(?:["'][a-z0-9_][a-z0-9_.-]*["']|[a-z0-9_][a-z0-9_.-]*)\s*\])*)\1(\s*[:=]\s*)/iuy;
  let cursor = 0;
  let redacted = "";
  let searchFrom = 0;

  for (
    let match = findTextAssignment(assignmentStart, value, searchFrom);
    match;
    match = findTextAssignment(assignmentStart, value, searchFrom)
  ) {
    const valueStart = match.index + match[0].length;
    searchFrom = valueStart;
    const key = match[2];
    if (!key || !isSensitiveTextKey(key, config)) continue;

    const serializedReplacement = JSON.stringify(config.replacement);
    const serializedReplacementEnd = valueStart + serializedReplacement.length;
    const valueEnd =
      value.startsWith(serializedReplacement, valueStart) &&
      isSerializedReplacementJsonValue(
        value,
        match.index,
        serializedReplacementEnd,
        match[1],
      )
        ? serializedReplacementEnd
        : findTextValueEnd(value, valueStart, key);
    const rawValue = value.slice(valueStart, valueEnd);
    const first = rawValue[0];
    const last = rawValue.at(-1);
    const unwrappedValue =
      (first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === "`" && last === "`") ||
      (first === "(" && last === ")")
        ? rawValue.slice(1, -1)
        : rawValue;
    if (
      rawValue === config.replacement ||
      unwrappedValue === config.replacement
    ) {
      searchFrom = valueEnd;
      continue;
    }

    redacted += value.slice(cursor, match.index);
    redacted += value.slice(match.index, valueStart) + config.replacement;
    cursor = valueEnd;
    searchFrom = valueEnd;
  }

  return cursor === 0 ? value : redacted + value.slice(cursor);
};

const ASSIGNMENT_VALUE_CLOSERS = new Map([
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
]);

// Where a free-form assignment's value ends, trying what used to be the
// value alternatives of one regex, in its order: a wrapped value, an
// authorization scheme with its credential, then a bare token. `unclosed`
// remembers how far a failed wrapper scan got. A later value opening the same
// wrapper before that point would scan to the same place and fail again, so
// text full of `key=(` no longer rescans to its end for every one of them.
const findAssignmentValueEnd = (
  value: string,
  start: number,
  unclosed: Map<string, number>,
): number | undefined => {
  const opener = value[start] ?? "";
  const closer = ASSIGNMENT_VALUE_CLOSERS.get(opener);
  if (closer && start >= (unclosed.get(opener) ?? 0)) {
    const wrapped =
      /"(?:\\.|[^"\\])*|'(?:\\.|[^'\\])*|`(?:\\.|[^`\\])*|\((?:\\.|[^)\\])*|\[[^\]]*|\{[^}]*/uy;
    wrapped.lastIndex = start;
    wrapped.exec(value);
    if (value[wrapped.lastIndex] === closer) return wrapped.lastIndex + 1;
    unclosed.set(opener, wrapped.lastIndex);
  }

  const bare = /(?:Bearer|Basic)\s+[^\s}\]"']+|[^\s}\]"']+/iuy;
  bare.lastIndex = start;
  return bare.test(value) ? bare.lastIndex : undefined;
};

// String#replace over free-form assignments, minus its quadratic cases: each
// key token is tried once and a value that never closes is scanned once.
const replaceTextAssignments = (
  value: string,
  assignment: RegExp,
  replace: (
    match: string,
    key: string,
    separator: string,
    rawValue: string,
  ) => string,
): string => {
  const unclosed = new Map<string, number>();
  let cursor = 0;
  let replaced = "";
  let searchFrom = 0;

  for (
    let match = findTextAssignment(assignment, value, searchFrom);
    match;
    match = findTextAssignment(assignment, value, searchFrom)
  ) {
    const [head, key = "", separator = ""] = match;
    const valueStart = match.index + head.length;
    const valueEnd = findAssignmentValueEnd(value, valueStart, unclosed);
    if (valueEnd === undefined) {
      // Every later start in this token reaches the same value.
      searchFrom = skipTextKeyToken(value, match.index);
      continue;
    }

    replaced +=
      value.slice(cursor, match.index) +
      replace(
        value.slice(match.index, valueEnd),
        key,
        separator,
        value.slice(valueStart, valueEnd),
      );
    cursor = valueEnd;
    searchFrom = valueEnd;
  }

  return cursor === 0 ? value : replaced + value.slice(cursor);
};

const redactTextWithConfig = (
  value: string,
  config: ResolvedRedactionConfig,
  nestingDepth: number,
): string => {
  const valueWithRedactedEncodedJson = redactEncodedJsonStringsInText(
    value,
    config,
  );
  const valueWithRedactedJson = redactJsonFragments(
    valueWithRedactedEncodedJson,
    config,
  );
  const valueWithRedactedJsonKeys = redactJsonStringKeyAssignments(
    valueWithRedactedJson,
    config,
  );
  const valueWithDirectRedaction = redactSensitiveAssignments(
    valueWithRedactedJsonKeys,
    config,
  );
  // Up to the separator only; findAssignmentValueEnd measures the value.
  const assignment =
    /(?<![a-z0-9_])([a-z0-9_][a-z0-9_.-]*(?:(?:\s*\?\.)?\s*\[\s*(?:["'][a-z0-9_][a-z0-9_.-]*["']|[a-z0-9_][a-z0-9_.-]*)\s*\])*)(\s*[:=]\s*)(?![a-z0-9_][a-z0-9_.-]*\s*[:=])/iuy;

  return replaceTextAssignments(
    valueWithDirectRedaction,
    assignment,
    (match, key, separator, rawValue) => {
      const isSensitive = isSensitiveTextKey(key, config);
      if (isSensitive) return `${key}${separator}${config.replacement}`;
      if (nestingDepth >= MAX_TEXT_NESTING_DEPTH) {
        return `${key}${separator}${config.replacement}`;
      }

      const first = rawValue[0];
      const last = rawValue.at(-1);
      let inner: string | undefined;
      let wrap: ((redacted: string) => string) | undefined;
      if (first === '"' && last === '"') {
        try {
          const decoded: unknown = JSON.parse(rawValue);
          if (typeof decoded === "string") {
            inner = decoded;
            wrap = (redacted) => JSON.stringify(redacted);
          }
        } catch {
          // Leave malformed quoted values untouched.
        }
      } else if (first === "'" && last === "'") {
        inner = rawValue.slice(1, -1);
        wrap = (redacted) => `'${redacted}'`;
      } else if (first === "`" && last === "`") {
        inner = rawValue.slice(1, -1);
        wrap = (redacted) => `\`${redacted}\``;
      } else if (first === "(" && last === ")") {
        inner = rawValue.slice(1, -1);
        wrap = (redacted) => `(${redacted})`;
      }
      if (inner === undefined || !wrap) return match;

      const redactedInner = redactTextWithConfig(
        inner,
        config,
        nestingDepth + 1,
      );
      return redactedInner === inner
        ? match
        : `${key}${separator}${wrap(redactedInner)}`;
    },
  );
};

export const redactText = (
  value: string,
  privacy?: QueuedashPrivacyConfig,
): string => {
  const config = resolveRedaction(privacy);
  if (!config) return value;
  return redactTextWithConfig(value, config, 0);
};

// Keyed per process: a hidden job id becomes a pseudonym that holds for as
// long as the server runs, so rows, selection and j/k stepping still tell
// jobs apart. Without the key, hashing guessed ids (sequential ones are easy)
// would reveal which job is which.
const JOB_ID_PSEUDONYM_KEY = randomBytes(32);

const pseudonymizeJobId = (id: unknown, replacement: string): string =>
  `${replacement}:${createHmac("sha256", JOB_ID_PSEUDONYM_KEY)
    .update(String(id))
    .digest("hex")
    .slice(0, 16)}`;

// Job options repeat identifiers, and key rules match names exactly, so hiding
// `id` never reached them. Bull and BullMQ keep a custom id in `jobId`, and
// repeatable jobs keep it in `repeat.jobId` (Bull also builds `repeat.key`
// from it); flow children hold their parent's id.
const JOB_ID_OPTION_PATHS = [
  ["jobId"],
  ["repeatJobKey"],
  ["parent", "id"],
  ["repeat", "jobId"],
  ["repeat", "key"],
];
// BullMQ Pro keeps the group in `group.id`; `groupId` is GroupMQ's add option.
const GROUP_ID_OPTION_PATHS = [["group", "id"], ["groupId"]];
// Bee-Queue keeps every failed attempt's stack in the job's own options.
const STACKTRACE_OPTION_KEYS = new Set(["stacktrace", "stacktraces"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const withoutStacktraceOptions = (opts: AdaptedJob["opts"]) =>
  isRecord(opts)
    ? Object.fromEntries(
        Object.entries(opts).filter(
          ([key]) => !STACKTRACE_OPTION_KEYS.has(key),
        ),
      )
    : opts;

const firstLine = (text: string | undefined): string | undefined => {
  if (typeof text !== "string") return text;
  const end = text.search(/[\r\n]/u);
  return end === -1 ? text : text.slice(0, end);
};

// Sets each path of the (freshly copied) redacted options from the raw value
// there - but only where the redacted options still have that field, so a
// parent another rule replaced wholesale keeps its replacement.
const presentOptionIdentities = (
  redacted: unknown,
  raw: unknown,
  paths: string[][],
  present: (value: unknown) => unknown,
): void => {
  for (const path of paths) {
    let target = redacted;
    let source = raw;
    for (const key of path.slice(0, -1)) {
      target = isRecord(target) ? target[key] : undefined;
      source = isRecord(source) ? source[key] : undefined;
    }
    const key = path.at(-1) ?? "";
    if (
      isRecord(target) &&
      isRecord(source) &&
      key in target &&
      source[key] != null
    ) {
      target[key] = present(source[key]);
    }
  }
};

export const presentJob = (
  job: AdaptedJob,
  privacy?: QueuedashPrivacyConfig,
): AdaptedJob => {
  const exposure = resolvePrivacyExposure(privacy);
  if (!privacy?.redact && Object.values(exposure).every(Boolean)) return job;

  const exposed: AdaptedJob = {
    ...job,
    data: exposure.jobData ? job.data : {},
    opts: exposure.jobOptions
      ? exposure.stacktraces
        ? job.opts
        : withoutStacktraceOptions(job.opts)
      : {},
    returnValue: exposure.returnValues ? job.returnValue : undefined,
    // A failure reason can carry a whole stack (Bee-Queue reports its first
    // stored trace), so hidden traces leave only the message line.
    failedReason: exposure.stacktraces
      ? job.failedReason
      : firstLine(job.failedReason),
    stacktrace: exposure.stacktraces ? job.stacktrace : undefined,
  };
  if (!privacy?.redact) return exposed;

  const redaction = resolveRedaction(privacy);
  const replacement = redaction?.replacement ?? DEFAULT_REPLACEMENT;
  const redacted = redactValue(exposed, privacy) as AdaptedJob;
  const redactId = privacyRedactsJobIdentity(privacy);
  const redactGroupId = privacyRedactsGroupIdentity(privacy);
  if (redactId) {
    // The same pseudonym as the job it names, so `opts.jobId` matches `id`
    // and a child's `parent.id` matches its parent's row.
    presentOptionIdentities(
      redacted.opts,
      exposed.opts,
      JOB_ID_OPTION_PATHS,
      (id) => pseudonymizeJobId(id, replacement),
    );
  }
  if (redactGroupId) {
    presentOptionIdentities(
      redacted.opts,
      exposed.opts,
      GROUP_ID_OPTION_PATHS,
      () => replacement,
    );
  }
  // Bee-Queue and GroupMQ use an identifier as the default job name.
  // Hiding that identifier must also hide its generated display alias.
  const nameIsHiddenIdentity =
    (redactId && exposed.name === exposed.id) ||
    (redactGroupId && exposed.name === exposed.groupId);
  return {
    ...redacted,
    name: nameIsHiddenIdentity ? replacement : redacted.name,
    // Unique per job: the UI keys rows, selection and j/k stepping by id.
    id: redactId ? pseudonymizeJobId(exposed.id, replacement) : exposed.id,
    // An id the producer chose, often from the data it deduplicates on.
    deduplicationId: redactId ? undefined : exposed.deduplicationId,
    groupId: redactGroupId
      ? exposed.groupId === undefined
        ? undefined
        : replacement
      : exposed.groupId,
    // Text is already sanitized by redactValue. Preserve explicit field and
    // element rules, keeping a wholly redacted trace an array on the wire.
    stacktrace:
      exposed.stacktrace === undefined
        ? undefined
        : Array.isArray(redacted.stacktrace)
          ? redacted.stacktrace
          : [replacement],
  };
};

export const presentLogs = (
  logs: string[] | null,
  privacy?: QueuedashPrivacyConfig,
): string[] | null =>
  resolvePrivacyExposure(privacy).logs
    ? (logs?.map((line) => redactText(line, privacy)) ?? null)
    : null;

export const presentErrorMessage = (
  error: unknown,
  privacy?: QueuedashPrivacyConfig,
): string | undefined =>
  error instanceof Error ? redactText(error.message, privacy) : undefined;

export const presentScheduler = (
  scheduler: SchedulerInfo,
  privacy?: QueuedashPrivacyConfig,
): SchedulerInfo => {
  const exposed = resolvePrivacyExposure(privacy).schedulerData
    ? scheduler
    : {
        ...scheduler,
        template: scheduler.template
          ? { ...scheduler.template, data: undefined, opts: undefined }
          : undefined,
      };
  const redacted = redactValue(exposed, privacy) as SchedulerInfo;
  return {
    ...redacted,
    key: privacyRedactsPath(privacy, ["key"]) ? redacted.key : exposed.key,
  };
};
