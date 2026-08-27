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
  const trailingWhitespace = value.match(/\s*$/u)?.[0] ?? "";
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
    return value.map((item, index) =>
      redactValueWithConfig(
        item,
        config,
        [...path, String(index)],
        seen,
        encodedJsonDepth,
      ),
    );
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

const redactJsonStringKeyAssignments = (
  value: string,
  config: ResolvedRedactionConfig,
): string => {
  const assignmentStart = /("(?:\\.|[^"\\])*")(\s*:\s*)/gu;
  let cursor = 0;
  let redacted = "";

  for (
    let match = assignmentStart.exec(value);
    match;
    match = assignmentStart.exec(value)
  ) {
    const serializedKey = match[1];
    if (!serializedKey) continue;

    let key: unknown;
    try {
      key = JSON.parse(serializedKey);
    } catch {
      continue;
    }
    if (typeof key !== "string" || !isSensitiveTextKey(key, config)) continue;

    const valueStart = assignmentStart.lastIndex;
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
      assignmentStart.lastIndex = valueEnd;
      continue;
    }

    redacted += value.slice(cursor, match.index);
    redacted += serializedKey + (match[2] ?? ":") + config.replacement;
    cursor = valueEnd;
    assignmentStart.lastIndex = valueEnd;
  }

  return cursor === 0 ? value : redacted + value.slice(cursor);
};

const redactSensitiveAssignments = (
  value: string,
  config: ResolvedRedactionConfig,
): string => {
  const assignmentStart =
    /(["']?)(?<![a-z0-9_])([a-z0-9_][a-z0-9_.-]*(?:\s*(?:\?\.)?\s*\[\s*(?:["'][a-z0-9_][a-z0-9_.-]*["']|[a-z0-9_][a-z0-9_.-]*)\s*\])*)\1(\s*[:=]\s*)/giu;
  let cursor = 0;
  let redacted = "";

  for (
    let match = assignmentStart.exec(value);
    match;
    match = assignmentStart.exec(value)
  ) {
    const key = match[2];
    if (!key || !isSensitiveTextKey(key, config)) continue;

    const valueStart = assignmentStart.lastIndex;
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
      assignmentStart.lastIndex = valueEnd;
      continue;
    }

    redacted += value.slice(cursor, match.index);
    redacted += value.slice(match.index, valueStart) + config.replacement;
    cursor = valueEnd;
    assignmentStart.lastIndex = valueEnd;
  }

  return cursor === 0 ? value : redacted + value.slice(cursor);
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
  const assignment =
    /(?<![a-z0-9_])([a-z0-9_][a-z0-9_.-]*(?:\s*(?:\?\.)?\s*\[\s*(?:["'][a-z0-9_][a-z0-9_.-]*["']|[a-z0-9_][a-z0-9_.-]*)\s*\])*)(\s*[:=]\s*)(?![a-z0-9_][a-z0-9_.-]*\s*[:=])("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\((?:\\.|[^)\\])*\)|\[[^\]]*\]|\{[^}]*\}|(?:Bearer|Basic)\s+[^\s}\]"']+|[^\s}\]"']+)/giu;

  return valueWithDirectRedaction.replace(
    assignment,
    (match, key: string, separator: string, rawValue: string) => {
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

export const presentJob = (
  job: AdaptedJob,
  privacy?: QueuedashPrivacyConfig,
): AdaptedJob => {
  const exposure = resolvePrivacyExposure(privacy);
  if (!privacy?.redact && Object.values(exposure).every(Boolean)) return job;

  const exposed: AdaptedJob = {
    ...job,
    data: exposure.jobData ? job.data : {},
    opts: exposure.jobOptions ? job.opts : {},
    returnValue: exposure.returnValues ? job.returnValue : undefined,
    stacktrace: exposure.stacktraces ? job.stacktrace : undefined,
  };
  if (!privacy?.redact) return exposed;

  const redaction = resolveRedaction(privacy);
  const redacted = redactValue(exposed, privacy) as AdaptedJob;
  return {
    ...redacted,
    id: privacyRedactsPath(privacy, ["id"]) ? redacted.id : exposed.id,
    groupId: privacyRedactsGroupIdentity(privacy)
      ? exposed.groupId === undefined
        ? undefined
        : redaction?.replacement
      : exposed.groupId,
    failedReason: exposed.failedReason
      ? redactText(exposed.failedReason, privacy)
      : undefined,
    stacktrace: exposed.stacktrace?.map((line) => redactText(line, privacy)),
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
