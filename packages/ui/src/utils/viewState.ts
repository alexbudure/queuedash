import { formatCount, pluralize } from "./format";
import type { Status } from "./trpc";

type JobSelectionActions = Partial<
  Record<"job.remove" | "job.rerun" | "job.retry", boolean>
>;

export type JobSort = "queue" | "newest" | "oldest";
export type TableLayoutVariant = "job" | "scheduler";

/** Mirrors QueuedashDensity from the API package, kept local so the table
 *  layout helpers do not depend on the provider. */
export type TableDensity = "comfortable" | "compact";

type JobAccessibleIdentity = {
  id: string;
  name?: string;
};

type SchedulerAccessibleIdentity = {
  key: string;
  name: string;
};

const REFRESH_INTERVAL_PRESETS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];

const getJobAccessibleIdentity = ({ id, name }: JobAccessibleIdentity) => {
  const trimmedName = name?.trim();
  return trimmedName ? `${trimmedName}, ID ${id}` : `ID ${id}`;
};

const getSchedulerAccessibleIdentity = ({
  key,
  name,
}: SchedulerAccessibleIdentity) => {
  const trimmedName = name.trim();
  return trimmedName && trimmedName !== key
    ? `${trimmedName}, key ${key}`
    : `key ${key}`;
};

export const getJobSelectionAriaLabel = (job: JobAccessibleIdentity) =>
  `Select job ${getJobAccessibleIdentity(job)}`;

export const getJobRowAriaLabel = (job: JobAccessibleIdentity) =>
  `Job ${getJobAccessibleIdentity(job)}. Press Enter or Space to open details`;

export const getSchedulerSelectionAriaLabel = (
  scheduler: SchedulerAccessibleIdentity,
) => `Select scheduler ${getSchedulerAccessibleIdentity(scheduler)}`;

export const getSchedulerRowAriaLabel = (
  scheduler: SchedulerAccessibleIdentity,
) =>
  `Scheduler ${getSchedulerAccessibleIdentity(scheduler)}. Press Enter or Space to open details`;

export const getJobRowId = (job: JobAccessibleIdentity) => job.id;

export const getSchedulerRowId = (scheduler: SchedulerAccessibleIdentity) =>
  scheduler.key;

export const getRowRangeSelection = (
  rows: ReadonlyArray<{ id: string }>,
  firstIndex: number,
  lastIndex: number,
) => {
  const selection: Record<string, boolean> = {};
  const start = Math.max(0, Math.min(firstIndex, lastIndex));
  const end = Math.min(rows.length - 1, Math.max(firstIndex, lastIndex));
  for (let index = start; index <= end; index += 1) {
    const row = rows[index];
    if (row) selection[row.id] = true;
  }
  return selection;
};

export const formatRefreshIntervalLabel = (value: number | false): string => {
  if (value === false) return "Off";
  if (value === 60_000) return "1 minute";
  const seconds = value / 1_000;
  return `${seconds.toLocaleString()} second${seconds === 1 ? "" : "s"}`;
};

export const getRefreshIntervalOptions = (
  ...currentValues: Array<number | false>
) => {
  const intervals = new Set(REFRESH_INTERVAL_PRESETS);
  for (const value of currentValues) {
    if (value !== false) intervals.add(value);
  }
  return [
    { label: formatRefreshIntervalLabel(false), value: "off" },
    ...Array.from(intervals)
      .sort((left, right) => left - right)
      .map((value) => ({
        label: formatRefreshIntervalLabel(value),
        value: String(value),
      })),
  ];
};

export const getJobListRefetchInterval = (
  loadedPageCount: number,
  refreshIntervalMs: number | false,
) => (loadedPageCount <= 1 ? refreshIntervalMs : false);

/**
 * True when live updates are suspended purely because more pages are loaded -
 * as opposed to the user having turned refreshing off. The table surfaces this
 * so frozen rows under a live tab-count bar are explained rather than
 * mysterious.
 */
export const isJobListPollingPaused = (
  loadedPageCount: number,
  refreshIntervalMs: number | false,
) => refreshIntervalMs !== false && loadedPageCount > 1;

/**
 * Prose forms of the status slugs. Only `waiting-children` differs, but a
 * confirm dialog reading "Remove all waiting-children jobs?" is the reason
 * user-facing copy goes through the map rather than the wire value.
 */
const STATUS_DISPLAY_NAMES: Record<Status, string> = {
  active: "active",
  completed: "completed",
  delayed: "delayed",
  failed: "failed",
  paused: "paused",
  prioritized: "prioritized",
  waiting: "waiting",
  "waiting-children": "waiting children",
};

export const getStatusDisplayName = (status: Status) =>
  STATUS_DISPLAY_NAMES[status];

/**
 * "1,204 matching failed jobs". The caller owns any "at least" prefix, so the
 * same phrase can open a sentence or sit inside "3 of … selected".
 */
export const formatJobCountLabel = ({
  hasFilter,
  status,
  total,
}: {
  hasFilter: boolean;
  status: Status;
  total: number;
}) =>
  `${formatCount(total)} ${hasFilter ? "matching " : ""}${getStatusDisplayName(
    status,
  )} ${pluralize(total, "job")}`;

export const getSchedulerScheduleError = (
  patternValue: string,
  everyValue: string,
) => {
  const trimmedPattern = patternValue.trim();
  const trimmedEvery = everyValue.trim();

  if (!trimmedPattern && !trimmedEvery) {
    return "Provide either a cron pattern or an interval.";
  }

  if (trimmedPattern && trimmedEvery) {
    return "Choose either a cron pattern or an interval, not both.";
  }

  if (!trimmedEvery) {
    return null;
  }

  const parsedEvery = Number(trimmedEvery);

  if (!Number.isFinite(parsedEvery) || parsedEvery <= 0) {
    return "Interval must be a positive number.";
  }

  return null;
};

export const getInitialSchedulerTimezone = ({
  browserTimezone,
  isEditing,
  schedulerTimezone,
}: {
  browserTimezone: string;
  isEditing: boolean;
  schedulerTimezone?: string;
}) => schedulerTimezone ?? (isEditing ? "" : browserTimezone);

export const getSchedulerTimezoneInput = (timezone: string) =>
  timezone.trim() || undefined;

export const getSchedulerTimezoneOptions = (
  supportedTimezones: readonly string[],
  currentTimezone: string,
) =>
  Array.from(
    new Set(
      ["UTC", currentTimezone, ...supportedTimezones].filter(
        (timezone) => timezone.length > 0,
      ),
    ),
  );

export const hasSharedJobViewParams = (params: URLSearchParams) =>
  Boolean(params.get("q")?.trim() || params.has("sort"));

export const updateJobQueryParams = (
  current: URLSearchParams,
  status: Status,
  query: string,
) => {
  const next = new URLSearchParams(current);
  if (query) next.set("q", query);
  else next.delete("q");
  next.set("status", status);
  return next;
};

export const updateJobSortParams = (
  current: URLSearchParams,
  status: Status,
  sort: JobSort,
) => {
  const next = new URLSearchParams(current);
  if (sort === "queue") next.delete("sort");
  else next.set("sort", sort);
  next.set("status", status);
  return next;
};

export const getQueuePath = (queueName: string) =>
  `../queues/${encodeURIComponent(queueName)}`;

export const shouldWriteEffectiveStatus = ({
  effectiveStatus,
  isSchedulersView,
  params,
}: {
  effectiveStatus: Status;
  isSchedulersView: boolean;
  params: URLSearchParams;
}) => {
  if (isSchedulersView) return false;

  const requestedStatus = params.get("status");
  return requestedStatus
    ? requestedStatus !== effectiveStatus
    : hasSharedJobViewParams(params);
};

export const canSelectJobRows = ({
  actions,
  status,
  supportsRetry,
}: {
  actions?: JobSelectionActions;
  status: Status;
  supportsRetry?: boolean;
}) =>
  actions?.["job.remove"] === true ||
  (status === "completed" && actions?.["job.rerun"] === true) ||
  (status === "failed" &&
    supportsRetry === true &&
    actions?.["job.retry"] === true);

export const getTableGridClassName = (
  variant: TableLayoutVariant,
  selectable: boolean,
) => {
  if (variant === "job") {
    // The lifecycle track's floor is its content - fixed-width segments that
    // line up row to row, which overlapped each other when squeezed. It has
    // to be a length: every row is its own grid, so a content-sized floor
    // would put each row's column boundary somewhere else.
    return selectable
      ? "grid-cols-[36px_minmax(0,22rem)_minmax(33.5rem,1fr)_100px]"
      : "grid-cols-[minmax(0,22rem)_minmax(33.5rem,1fr)_100px]";
  }

  return selectable
    ? "grid-cols-[36px_minmax(0,30%)_minmax(0,1fr)_minmax(0,1fr)]"
    : "grid-cols-[minmax(0,30%)_minmax(0,1fr)_minmax(0,1fr)]";
};

/**
 * The minimum width a table needs before its columns stop being readable.
 * Below this the rows scroll sideways. Previously the grid was `min-w-max`,
 * which meant "as wide as the widest row" - 1275px at every viewport,
 * including 375px.
 *
 * For jobs: the lifecycle floor, the fixed tracks and padding, and 14rem left
 * over for the job name - still inside the card on a 1280px screen.
 */
export const getTableMinWidthClassName = (variant: TableLayoutVariant) =>
  variant === "job" ? "min-w-[912px]" : "min-w-[640px]";

/**
 * Row and header padding, derived from density.
 *
 * This lives here so the skeleton and the real row can't drift: they used to
 * disagree by 4px in comfortable and 8px in compact, so the whole table
 * resized the moment data landed.
 */
export const getTableRowPaddingClassName = (density: TableDensity) =>
  density === "compact" ? "py-0" : "py-0.5";

export const getTableCellPaddingClassName = (density: TableDensity) =>
  density === "compact" ? "py-1" : "py-2";

export const getTableHeaderPaddingClassName = (density: TableDensity) =>
  density === "compact" ? "py-1.5" : "py-2";
