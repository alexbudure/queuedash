import type { AdaptedJob, SchedulerInfo } from "./queue-adapters/base.adapter";
import type { QueuedashPrivacyConfig, QueuedashRedactionConfig } from "./trpc";

const DEFAULT_REDACTED_KEYS = [
  "accessToken",
  "apiKey",
  "authorization",
  "cookie",
  "creditCard",
  "password",
  "privateKey",
  "refreshToken",
  "secret",
  "session",
  "ssn",
  "token",
];
const DEFAULT_REPLACEMENT = "[REDACTED]";

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

const redactValueWithConfig = (
  value: unknown,
  config: ResolvedRedactionConfig,
  path: string[] = [],
  seen = new WeakSet<object>(),
): unknown => {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) return value;
  if (seen.has(value)) return config.replacement;

  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      redactValueWithConfig(item, config, [...path, String(index)], seen),
    );
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => {
      const childPath = [...path, key];
      return [
        key,
        shouldRedact(key, childPath, config)
          ? config.replacement
          : redactValueWithConfig(child, config, childPath, seen),
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

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const redactText = (
  value: string,
  privacy?: QueuedashPrivacyConfig,
): string => {
  const config = resolveRedaction(privacy);
  if (!config) return value;

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      return JSON.stringify(redactValueWithConfig(parsed, config));
    }
  } catch {
    // Non-JSON logs are handled by the conservative key/value matcher below.
  }

  const keys = Array.from(config.keys).filter(Boolean).map(escapeRegExp);
  if (keys.length === 0) return value;

  const assignment = new RegExp(
    `\\b(${keys.join("|")})\\b(\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;]+)`,
    "giu",
  );
  return value.replace(
    assignment,
    (_match, key: string, separator: string) =>
      `${key}${separator}${config.replacement}`,
  );
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

  const redacted = redactValue(exposed, privacy) as AdaptedJob;
  return {
    ...redacted,
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
          ? { ...scheduler.template, data: undefined }
          : undefined,
      };
  return redactValue(exposed, privacy) as SchedulerInfo;
};
