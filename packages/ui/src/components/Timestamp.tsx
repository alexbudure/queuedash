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
  return formatter.format(Math.round(seconds / 86_400), "day");
};

export const formatAbsoluteTimestamp = (
  value: TimestampValue,
  variant: TimestampVariant = "date",
): string => {
  const date = toDate(value);
  if (!date) return "-";

  if (variant === "time") {
    return date.toLocaleString("en-US", {
      hour: "numeric",
      minute: "numeric",
    });
  }

  return date.toLocaleString("en-US", {
    month: variant === "full" ? "short" : "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "numeric",
    ...(variant === "full" ? { second: "numeric", timeZoneName: "short" } : {}),
  });
};

export const Timestamp = ({
  value,
  variant = "date",
}: {
  value: TimestampValue;
  variant?: TimestampVariant;
}) => {
  const { preferences } = useQueuedash();
  const isRelative = preferences.timestamps === "relative";
  const now = useSyncExternalStore(
    isRelative ? subscribeToRelativeTimestamps : doNotSubscribe,
    isRelative ? getCurrentNow : getStaticNow,
    isRelative ? getCurrentNow : getStaticNow,
  );

  return isRelative
    ? formatRelativeTimestamp(value, now)
    : formatAbsoluteTimestamp(value, variant);
};
