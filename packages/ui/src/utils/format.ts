/**
 * Shared formatting helpers.
 *
 * These exist because the same value used to be rendered four different ways
 * on the same screen: a 90-second job read "1.50m" in the table badge, "1.50m"
 * in the job panel's Duration field and "1.5m" in the timeline directly above
 * it, and a three-hour job read "180.00m".
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Humanizes a millisecond duration.
 *
 *   840      -> "840ms"
 *   4_200    -> "4.2s"
 *   45_000   -> "45s"
 *   90_000   -> "1m 30s"
 *   11_520_000 -> "3h 12m"
 *   190_800_000 -> "2d 5h"
 */
export const formatDuration = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";

  const ms = Math.max(0, value);

  if (ms < SECOND) return `${Math.round(ms)}ms`;

  if (ms < 10 * SECOND) {
    const seconds = ms / SECOND;
    // Drop a trailing ".0" so 5000ms reads "5s", not "5.0s".
    const rounded = Math.round(seconds * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}s` : `${rounded.toFixed(1)}s`;
  }

  if (ms < MINUTE) {
    const seconds = Math.round(ms / SECOND);
    // 59_999ms rounds to 60 - carry rather than render a unit that can't exist.
    return seconds === 60 ? "1m" : `${seconds}s`;
  }

  if (ms < HOUR) {
    const minutes = Math.floor(ms / MINUTE);
    const seconds = Math.round((ms % MINUTE) / SECOND);
    // 119s must not render as "1m 60s", and 59m59.6s must not become "60m".
    if (seconds === 60) return minutes === 59 ? "1h" : `${minutes + 1}m`;
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.round((ms % HOUR) / MINUTE);
    if (minutes === 60) return hours === 23 ? "1d" : `${hours + 1}h`;
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const days = Math.floor(ms / DAY);
  const hours = Math.round((ms % DAY) / HOUR);
  if (hours === 24) return `${days + 1}d`;
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
};

/**
 * Formats a duration expressed in seconds. Convenience wrapper so callers
 * holding seconds don't each multiply by 1000 in their own way.
 */
export const formatDurationFromSeconds = (
  value: number | null | undefined,
): string =>
  value === null || value === undefined ? "-" : formatDuration(value * SECOND);

/**
 * "1 job" / "2 jobs". Pass an explicit plural for irregular words.
 */
export const pluralize = (
  count: number,
  singular: string,
  plural = `${singular}s`,
): string => (count === 1 ? singular : plural);

/**
 * Thousands separators, so a busy queue reads "1,204,331" rather than
 * "1204331". Compact form for the tight overview stat cells.
 */
export const formatCount = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return value.toLocaleString("en-US");
};

/**
 * `formatCount` with a k/M suffix once the number stops fitting a stat cell.
 */
export const formatCompactCount = (
  value: number | null | undefined,
): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (Math.abs(value) < 10_000) return value.toLocaleString("en-US");
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
};

/**
 * "1,204 jobs" in one call, with the count formatted and the noun agreeing.
 */
export const formatCountLabel = (
  count: number,
  singular: string,
  plural?: string,
): string => `${formatCount(count)} ${pluralize(count, singular, plural)}`;
