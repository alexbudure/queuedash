import { formatCount, pluralize } from "./format";
import type { Status } from "./trpc";
import { getStatusDisplayName } from "./viewState";

/**
 * One end of a job list's date range: a moment, or an offset from now. An
 * offset is resolved by the server on every request, so "Last hour" stays the
 * last hour while the list polls, and a shared link means the same to whoever
 * opens it later.
 */
export type RangeBound = { at: number } | { offset: number };

export type DateRange = { from?: RangeBound; to?: RangeBound };

export type RangePreset = { id: string; label: string; range: DateRange };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const UNIT_MS = { m: MINUTE, h: HOUR, d: DAY } as const;
// `now-15m`, `now+1h`, `now-7d`: the URL form of an offset.
const RELATIVE_BOUND = /^now([+-])(\d{1,5})([mhd])$/;
const ABSOLUTE_BOUND = /^\d{1,15}$/;

const parseRangeBound = (value: string | null): RangeBound | undefined => {
  if (!value) return undefined;
  const relative = RELATIVE_BOUND.exec(value);
  if (relative) {
    const [, sign, amount, unit] = relative;
    const offset = Number(amount) * UNIT_MS[unit as keyof typeof UNIT_MS];
    return { offset: sign === "-" ? -offset : offset };
  }
  return ABSOLUTE_BOUND.test(value) ? { at: Number(value) } : undefined;
};

const serializeRangeBound = (bound: RangeBound): string => {
  if ("at" in bound) return String(Math.round(bound.at));
  const size = Math.abs(bound.offset);
  const [unit, unitMs] =
    size % DAY === 0
      ? ["d", DAY]
      : size % HOUR === 0
        ? ["h", HOUR]
        : ["m", MINUTE];
  return `now${bound.offset < 0 ? "-" : "+"}${Math.round(size / unitMs)}${unit}`;
};

/** The range in a URL's `from` and `to` params. */
export const readDateRange = (
  from: string | null,
  to: string | null,
): DateRange => ({ from: parseRangeBound(from), to: parseRangeBound(to) });

export const writeDateRange = (params: URLSearchParams, range: DateRange) => {
  if (range.from) params.set("from", serializeRangeBound(range.from));
  else params.delete("from");
  if (range.to) params.set("to", serializeRangeBound(range.to));
  else params.delete("to");
};

export const hasDateRange = (range: DateRange) =>
  Boolean(range.from || range.to);

const isSameBound = (left?: RangeBound, right?: RangeBound) =>
  left === undefined || right === undefined
    ? left === right
    : "at" in left
      ? "at" in right && left.at === right.at
      : "offset" in right && left.offset === right.offset;

export const isSameDateRange = (left: DateRange, right: DateRange) =>
  isSameBound(left.from, right.from) && isSameBound(left.to, right.to);

/** The range as `job.list` and the bulk actions take it. */
export const toDateRangeInput = (range: DateRange) => ({
  from: range.from && "at" in range.from ? range.from.at : undefined,
  fromOffset:
    range.from && "offset" in range.from ? range.from.offset : undefined,
  to: range.to && "at" in range.to ? range.to.at : undefined,
  toOffset: range.to && "offset" in range.to ? range.to.offset : undefined,
});

export const resolveRangeBound = (bound: RangeBound, now = Date.now()) =>
  "at" in bound ? bound.at : now + bound.offset;

/**
 * Which of a job's moments the range is judged by. Finished jobs by when they
 * finished, delayed jobs by when they are due, and the rest by when they were
 * added.
 */
const getRangeBasis = (status: Status) =>
  status === "completed" || status === "failed"
    ? "finished"
    : status === "delayed"
      ? "due"
      : "added";

/** "Failed between", "Due between": the popover's title says which moment. */
export const getDateRangeTitle = (status: Status) => {
  const basis = getRangeBasis(status);
  return basis === "finished"
    ? `${status === "failed" ? "Failed" : "Completed"} between`
    : basis === "due"
      ? "Due between"
      : "Added between";
};

const SPANS = [
  { ms: 15 * MINUTE, label: "15 minutes" },
  { ms: HOUR, label: "hour" },
  { ms: DAY, label: "24 hours" },
  { ms: 7 * DAY, label: "7 days" },
];

const formatSpan = (ms: number) =>
  SPANS.find((span) => span.ms === ms)?.label ??
  (ms % DAY === 0
    ? `${ms / DAY} days`
    : ms % HOUR === 0
      ? `${ms / HOUR} hours`
      : `${Math.round(ms / MINUTE)} minutes`);

/**
 * Delayed jobs are due in the future, so their presets look ahead; "Next hour"
 * also keeps any that are already overdue.
 */
export const getDateRangePresets = (status: Status): RangePreset[] =>
  SPANS.map(({ ms, label }) =>
    getRangeBasis(status) === "due"
      ? {
          id: `next-${ms}`,
          label: `Next ${label}`,
          range: { to: { offset: ms } },
        }
      : {
          id: `last-${ms}`,
          label: `Last ${label}`,
          range: { from: { offset: -ms } },
        },
  );

const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);

const getMomentFormat = (moments: number[], now: number) => {
  const today = startOfDay(now);
  const thisYear = new Date(now).getFullYear();
  const showSeconds = moments.some((ms) => ms % MINUTE !== 0);
  return new Intl.DateTimeFormat("en-US", {
    ...(moments.every((ms) => startOfDay(ms) === today)
      ? {}
      : {
          month: "short",
          day: "numeric",
          ...(moments.every((ms) => new Date(ms).getFullYear() === thisYear)
            ? {}
            : { year: "numeric" }),
        }),
    hour: "numeric",
    minute: "2-digit",
    ...(showSeconds ? { second: "2-digit" } : {}),
  });
};

/** A moment as short as it can be told: "3:18 PM" today, "Sep 29, 9:00 AM". */
export const formatMoment = (ms: number, now = Date.now()) =>
  getMomentFormat([ms], now).format(ms);

/** The trigger's label: "Any time", "Last hour", "9:12 – 9:40 AM". */
export const formatDateRangeLabel = (range: DateRange, now = Date.now()) => {
  const { from, to } = range;
  if (!from && !to) return "Any time";
  if (from && "offset" in from && from.offset < 0 && !to) {
    return `Last ${formatSpan(-from.offset)}`;
  }
  if (to && "offset" in to && to.offset > 0 && !from) {
    return `Next ${formatSpan(to.offset)}`;
  }
  const start = from && resolveRangeBound(from, now);
  const end = to && resolveRangeBound(to, now);
  if (start !== undefined && end !== undefined && start <= end) {
    return getMomentFormat([start, end], now).formatRange(start, end);
  }
  if (start !== undefined && end === undefined) {
    return `Since ${getMomentFormat([start], now).format(start)}`;
  }
  if (end !== undefined && start === undefined) {
    return `Until ${getMomentFormat([end], now).format(end)}`;
  }
  return "Custom range";
};

/**
 * The range as the end of a sentence about the jobs in it: "in the last hour",
 * "added since 9:12 AM", "due between 9:00 AM and 11:00 AM".
 */
export const describeDateRange = (
  range: DateRange,
  status: Status,
  now = Date.now(),
) => {
  const basis = getRangeBasis(status);
  const verb = basis === "added" ? "added " : basis === "due" ? "due " : "";
  const { from, to } = range;
  if (from && "offset" in from && from.offset < 0 && !to) {
    return `${verb}in the last ${formatSpan(-from.offset)}`;
  }
  if (to && "offset" in to && to.offset > 0 && !from) {
    return `${verb}in the next ${formatSpan(to.offset)}`;
  }
  const start = from && resolveRangeBound(from, now);
  const end = to && resolveRangeBound(to, now);
  const format = getMomentFormat(
    [start, end].filter((ms): ms is number => ms !== undefined),
    now,
  );
  if (start !== undefined && end !== undefined) {
    return `${verb}between ${format.format(start)} and ${format.format(end)}`;
  }
  if (start !== undefined) return `${verb}since ${format.format(start)}`;
  if (end !== undefined) return `${verb}before ${format.format(end)}`;
  return "";
};

/** "38 failed jobs", as the phone sheet's button counts them. */
export const formatStatusJobCount = (total: number, status: Status) =>
  `${formatCount(total)} ${getStatusDisplayName(status)} ${pluralize(total, "job")}`;

/** "Your time zone (EDT)." The range fields are in the browser's local time. */
export const getLocalTimeZoneName = (now = Date.now()) =>
  new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName")?.value ?? "local";

const pad = (value: number) => String(value).padStart(2, "0");

/** A moment as a `datetime-local` value, which is local wall-clock time. */
export const toLocalInputValue = (ms: number) => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
};

export const fromLocalInputValue = (value: string): number | undefined => {
  if (!value) return undefined;
  // A date-time with no offset parses as local time.
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : ms;
};
