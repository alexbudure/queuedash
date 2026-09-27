import { useSyncExternalStore } from "react";

import { useQueuedash } from "./QueuedashProvider";

type TimestampValue = Date | number | string | null | undefined;
type TimestampVariant = "date" | "full" | "time";

let currentNow = Date.now();
let ticker: ReturnType<typeof setInterval> | undefined;
const relativeTimestampListeners = new Set<() => void>();

const subscribeToRelativeTimestamps = (listener: () => void) => {
  relativeTimestampListeners.add(listener);
  if (relativeTimestampListeners.size === 1) {
    currentNow = Date.now();
    ticker = setInterval(() => {
      currentNow = Date.now();
      relativeTimestampListeners.forEach((notify) => notify());
    }, 1_000);
  }

  return () => {
    relativeTimestampListeners.delete(listener);
    if (relativeTimestampListeners.size === 0 && ticker !== undefined) {
      clearInterval(ticker);
      ticker = undefined;
    }
  };
};

const doNotSubscribe = () => () => {};
const getCurrentNow = () => currentNow;
const getStaticNow = () => 0;

const toDate = (value: TimestampValue): Date | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatRelativeTimestamp = (
  value: TimestampValue,
  now = Date.now(),
): string => {
  const date = toDate(value);
  if (!date) return "-";

  const seconds = Math.round((date.getTime() - now) / 1_000);
  const absoluteSeconds = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absoluteSeconds < 60) return formatter.format(seconds, "second");
  if (absoluteSeconds < 3_600) {
    return formatter.format(Math.round(seconds / 60), "minute");
  }
  if (absoluteSeconds < 86_400) {
    return formatter.format(Math.round(seconds / 3_600), "hour");
  }
  if (absoluteSeconds < 604_800) {
    return formatter.format(Math.round(seconds / 86_400), "day");
  }
  if (absoluteSeconds < 2_629_800) {
    return formatter.format(Math.round(seconds / 604_800), "week");
  }
  // Average month/year lengths - a relative label never needs calendar accuracy.
  if (absoluteSeconds < 31_557_600) {
    return formatter.format(Math.round(seconds / 2_629_800), "month");
  }
  return formatter.format(Math.round(seconds / 31_557_600), "year");
};

/**
 * A scheduler can carry any time zone string the server was configured with,
 * and an unknown zone makes `toLocaleString` throw. Fall back to the browser's
 * zone rather than taking the dashboard down.
 */
const localeString = (
  date: Date,
  options: Intl.DateTimeFormatOptions,
  timeZone?: string,
): string => {
  if (!timeZone) return date.toLocaleString("en-US", options);
  try {
    return date.toLocaleString("en-US", { ...options, timeZone });
  } catch {
    return date.toLocaleString("en-US", options);
  }
};

export const formatAbsoluteTimestamp = (
  value: TimestampValue,
  variant: TimestampVariant = "date",
  timeZone?: string,
): string => {
  const date = toDate(value);
  if (!date) return "-";

  if (variant === "time") {
    return localeString(date, { hour: "numeric", minute: "numeric" }, timeZone);
  }

  return localeString(
    date,
    {
      month: variant === "full" ? "short" : "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
      ...(variant === "full"
        ? { second: "numeric", timeZoneName: "short" }
        : {}),
    },
    timeZone,
  );
};

export const Timestamp = ({
  value,
  variant = "date",
  timeZone,
}: {
  value: TimestampValue;
  variant?: TimestampVariant;
  timeZone?: string;
}) => {
  const { preferences } = useQueuedash();
  const isRelative = preferences.timestamps === "relative";
  const now = useSyncExternalStore(
    isRelative ? subscribeToRelativeTimestamps : doNotSubscribe,
    isRelative ? getCurrentNow : getStaticNow,
    isRelative ? getCurrentNow : getStaticNow,
  );

  // Relative mode is the default, so without this the wall-clock time - the
  // one a postmortem needs - is unreachable for every job in the table.
  const absolute = formatAbsoluteTimestamp(value, "full", timeZone);

  return (
    <span title={absolute === "-" ? undefined : absolute}>
      {isRelative
        ? formatRelativeTimestamp(value, now)
        : formatAbsoluteTimestamp(value, variant, timeZone)}
    </span>
  );
};
