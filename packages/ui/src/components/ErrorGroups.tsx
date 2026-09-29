import { keepPreviousData } from "@tanstack/react-query";
import { clsx } from "clsx";
import { RotateCw, Trash2, X } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

import { NUM_OF_RETRIES } from "../utils/config";
import { formatCount } from "../utils/format";
import { BULK_VERBS, bulkResultToast } from "../utils/mutationToasts";
import {
  FOCUS_RING,
  FOCUS_RING_INSET,
  TEXT_FAINT,
  TEXT_MUTED,
} from "../utils/styles";
import type { Queue, RouterInput, RouterOutput } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { ErrorCard } from "./ErrorCard";
import { PHONE_HAIRLINE, PHONE_SELECT } from "./phoneStyles";
import { useQueuedash } from "./QueuedashProvider";
import { Select, type SelectOption } from "./Select";
import { Skeleton } from "./Skeleton";
import { formatAbsoluteTimestamp } from "./Timestamp";

export type ErrorRange = RouterInput["job"]["errorGroups"]["range"] & string;
export type ErrorSort = "count" | "recent";
export type ErrorGroup = RouterOutput["job"]["errorGroups"]["groups"][number];

export const ERROR_RANGES: ReadonlyArray<SelectOption<ErrorRange>> = [
  { label: "Last hour", value: "1h" },
  { label: "Last 24 hours", value: "24h" },
  { label: "Last 7 days", value: "7d" },
  { label: "Everything kept", value: "all" },
];

const SORTS: ReadonlyArray<SelectOption<ErrorSort>> = [
  { label: "Most jobs", value: "count" },
  { label: "Most recent", value: "recent" },
];

const RANGE_PHRASES: Record<ErrorRange, string> = {
  "1h": " in the last hour",
  "24h": " in the last 24 hours",
  "7d": " in the last 7 days",
  all: "",
};

// The Errors tab reads up to 5,000 jobs a request, so it polls on the same
// slow floor as the other scanned lists.
const ERROR_GROUPS_MIN_REFRESH_MS = 10_000;
const HOUR_MS = 3_600_000;
// Error | Jobs | Last 24 hours | Last seen | actions
const GRID_COLUMNS = "minmax(330px, 1fr) 78px 150px 112px 150px";

// A masked part of a message, the same in the table and on a phone card.
const MASK_CHIP =
  "mx-px inline-block rounded bg-gray-100 px-1 font-sans text-[11px] leading-4 dark:bg-slate-800";

// How much of the text on either side stays glued to a masked part. The
// brackets, quotes and units it stands inside are a few characters; the cap
// keeps an unbroken run around it breakable at all.
const GLUE_BEFORE = /\S{1,16}$/;
const GLUE_AFTER = /^\S{1,16}/;

const NEW_PILL =
  "rounded-full border border-brand-200 bg-brand-50 font-sans text-[11px] font-medium text-brand-700 dark:border-brand-800 dark:bg-brand-950/60 dark:text-brand-300";

// The phone card's bars: 3px on a 5px step, no baseline, and an empty hour
// drawn as a stub so the row still reads as a whole day.
const SPARK = { height: 18, step: 5, bar: 3 };

// "46s ago", "3h ago": the Last seen column is narrow, and the exact time is
// in the tooltip.
const formatAgo = (time: number, now: number) => {
  const seconds = Math.max(0, Math.round((now - time) / 1_000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

export const isErrorRange = (value: string | null): value is ErrorRange =>
  ERROR_RANGES.some((range) => range.value === value);

export const isErrorFingerprint = (value: string | null): value is string =>
  !!value && /^[0-9a-f]{16}$/.test(value);

/** An error's message, with each masked part shown as what it stood for. */
export const ErrorMessage = ({
  type,
  message,
}: {
  type: string | null;
  message: string;
}) => {
  // Split around the ‹kind› markers: text and kinds alternate.
  const pieces = message.split(/‹(\w+)›/g);
  const parts: ReactNode[] = [];
  let text = pieces[0] ?? "";
  for (let index = 1; index < pieces.length; index += 2) {
    // A masked part must not wrap away from what it stands in: "(‹size›)"
    // used to break after its bracket and "‹num›ms" before its unit, so
    // whatever touches it on either side stays on its line.
    const before = GLUE_BEFORE.exec(text)?.[0] ?? "";
    const rest = pieces[index + 1] ?? "";
    const after = GLUE_AFTER.exec(rest)?.[0] ?? "";
    parts.push(text.slice(0, text.length - before.length));
    parts.push(
      <span key={index} className="inline-block whitespace-nowrap">
        {before}
        <span className={clsx(MASK_CHIP, TEXT_MUTED)}>{pieces[index]}</span>
        {after}
      </span>,
    );
    text = rest.slice(after.length);
  }
  parts.push(text);

  return (
    <>
      {type ? (
        <span className="font-semibold text-red-700 dark:text-red-400">
          {type}
        </span>
      ) : null}
      {type ? ": " : null}
      {parts}
    </>
  );
};

/** The same as plain text, for labels and chips. Untyped errors (stack
 *  traces hidden) still say what they are. */
export const formatErrorLabel = (group: {
  type: string | null;
  message: string;
}) => `${group.type ?? "Error"}: ${group.message}`;

const HourlyBars = ({ hourly }: { hourly: number[] }) => {
  const max = Math.max(...hourly, 1);
  const slot = 122 / hourly.length;
  const busiest = hourly.reduce(
    (best, count, index) => (count > (hourly[best] ?? 0) ? index : best),
    0,
  );
  return (
    <svg
      viewBox="0 0 122 28"
      className="block h-7 w-[122px]"
      role="img"
      aria-label={`Failures per hour over the last 24 hours, most ${
        hourly[busiest] ?? 0
      } in one hour`}
    >
      <line
        x1="0"
        y1="27.5"
        x2="122"
        y2="27.5"
        className="stroke-gray-200 dark:stroke-slate-700"
        strokeWidth="1"
      />
      {hourly.map((count, index) => {
        if (count === 0) return null;
        const height = Math.max(2, (count / max) * 25);
        // The last three hours are drawn solid: what is happening now reads
        // before what happened this morning.
        const isRecent = index >= hourly.length - 3;
        return (
          <rect
            // Buckets are positional, oldest first.
            key={index}
            x={index * slot + 0.75}
            y={27 - height}
            width={slot - 1.5}
            height={height}
            rx="1"
            className={clsx(
              "fill-red-500",
              isRecent ? "opacity-85" : "opacity-35",
            )}
          />
        );
      })}
    </svg>
  );
};

/** The same 24 hours beside a phone card's meta line. Decoration there: the
 *  card already says how many jobs and when. */
const HourlySpark = ({ hourly }: { hourly: number[] }) => {
  const max = Math.max(...hourly, 1);
  const width = hourly.length * SPARK.step - (SPARK.step - SPARK.bar);
  return (
    <svg
      viewBox={`0 0 ${width} ${SPARK.height}`}
      width={width}
      height={SPARK.height}
      className="block shrink-0"
      aria-hidden="true"
    >
      {hourly.map((count, index) => {
        const height = Math.max(2, (count / max) * SPARK.height);
        const isRecent = index >= hourly.length - 3;
        return (
          <rect
            key={index}
            x={index * SPARK.step}
            y={SPARK.height - height}
            width={SPARK.bar}
            height={height}
            rx="1"
            className={clsx(
              "fill-red-500",
              count === 0
                ? "opacity-25"
                : isRecent
                  ? "opacity-85"
                  : "opacity-35",
            )}
          />
        );
      })}
    </svg>
  );
};

type ErrorGroupsProps = {
  queueName: string;
  queue: Queue | undefined;
  range: ErrorRange;
  sort: ErrorSort;
  onRangeChange: (range: ErrorRange) => void;
  onSortChange: (sort: ErrorSort) => void;
  onOpenGroup: (group: ErrorGroup) => void;
};

export const ErrorGroups = ({
  queueName,
  queue,
  range,
  sort,
  onRangeChange,
  onSortChange,
  onOpenGroup,
}: ErrorGroupsProps) => {
  const { preferences } = useQueuedash();
  const groupsReq = trpc.job.errorGroups.useQuery(
    { queueName, range },
    {
      enabled: !!queueName && !!queue,
      refetchInterval:
        preferences.refreshIntervalMs === false
          ? false
          : Math.max(
              preferences.refreshIntervalMs,
              ERROR_GROUPS_MIN_REFRESH_MS,
            ),
      retry: NUM_OF_RETRIES,
      placeholderData: keepPreviousData,
    },
  );

  const canRetry =
    queue?.supports.retry === true && queue.access.actions["job.retry"];
  const canRemove = queue?.access.actions["job.remove"] === true;
  const retryByFilter = trpc.job.bulkRetryByFilter.useMutation({
    onSuccess: (result) => bulkResultToast(BULK_VERBS.retry, "job", result),
  });
  const removeByFilter = trpc.job.bulkRemoveByFilter.useMutation({
    onSuccess: (result) => bulkResultToast(BULK_VERBS.remove, "job", result),
  });

  const data = groupsReq.data;
  const groups = data
    ? [...data.groups].sort((left, right) =>
        sort === "recent"
          ? right.lastSeen - left.lastSeen
          : right.count - left.count || right.lastSeen - left.lastSeen,
      )
    : [];
  const now = data?.now ?? Date.now();
  // A group is new only if the kept failures reach back far enough to know
  // it did not happen before: on a queue that keeps an hour of failures,
  // everything would otherwise look new.
  const reachesBackAnHour =
    data?.oldestFailureAt !== null &&
    data?.oldestFailureAt !== undefined &&
    data.oldestFailureAt < now - HOUR_MS;
  const isNewGroup = (group: ErrorGroup) =>
    reachesBackAnHour && group.firstSeen >= now - HOUR_MS;

  // A phone card carries no buttons, so its footnote says where they are.
  const bulkActions = [canRetry && "Retry all", canRemove && "Remove all"]
    .filter(Boolean)
    .join(" and ");
  const tapHint = `Tap an error for its jobs${
    bulkActions ? `, with ${bulkActions}` : ""
  }.`;

  if (groupsReq.isError) {
    return (
      <ErrorCard
        title="Could not group failures"
        message={groupsReq.error.message}
        onRetry={() => groupsReq.refetch()}
        isRetrying={groupsReq.isRefetching}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* On a phone the summary takes its own line above the two selects. */}
      <div className="flex flex-wrap items-center gap-2.5 max-sm:gap-x-2">
        <div className="min-w-0 flex-1 text-sm text-gray-700 max-sm:basis-full max-sm:text-[15px] max-sm:leading-[22px] dark:text-slate-300">
          {!data ? (
            <Skeleton className="h-4 w-56 rounded" />
          ) : data.groups.length > 0 ? (
            <>
              <b className="font-semibold text-gray-900 dark:text-white">
                {formatCount(data.groups.length)}{" "}
                {data.groups.length === 1 ? "error" : "errors"}
              </b>{" "}
              across {formatCount(data.failedInRange)} failed{" "}
              {data.failedInRange === 1 ? "job" : "jobs"}
              {RANGE_PHRASES[range]}
            </>
          ) : (
            <span className={TEXT_MUTED}>
              {range === "all"
                ? "No failed jobs kept."
                : `No failures${RANGE_PHRASES[range]}.`}
            </span>
          )}
        </div>
        <Select<ErrorRange>
          ariaLabel="Time range"
          options={ERROR_RANGES}
          value={range}
          onChange={onRangeChange}
          className={PHONE_SELECT}
        />
        <Select<ErrorSort>
          ariaLabel="Sort errors"
          options={SORTS}
          value={sort}
          onChange={onSortChange}
          className={PHONE_SELECT}
        />
      </div>

      {!data ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : groups.length > 0 ? (
        <>
          {/* Phone: a card per error, tapped for its jobs. Retry all and
              Remove all live on that list's bulk bar, under the thumb. */}
          <ul
            role="list"
            aria-label={`Errors in ${queue?.displayName ?? queueName}`}
            className="sm:hidden"
          >
            {groups.map((group) => (
              <li key={group.fingerprint}>
                <button
                  type="button"
                  onClick={() => onOpenGroup(group)}
                  className={clsx(
                    "block w-full border-t py-3.5 text-left transition-colors duration-150 active:bg-gray-50 dark:active:bg-slate-800/40",
                    PHONE_HAIRLINE,
                    FOCUS_RING_INSET,
                  )}
                >
                  <span className="block font-mono text-[13px] leading-[19px] break-words text-gray-900 dark:text-white">
                    <ErrorMessage type={group.type} message={group.message} />
                  </span>
                  {group.frame ? (
                    <span
                      className={clsx(
                        "mt-1 block truncate font-mono text-xs leading-4",
                        TEXT_MUTED,
                      )}
                    >
                      {group.frame}
                    </span>
                  ) : null}
                  <span className="mt-2.5 flex items-center justify-between gap-3">
                    <span
                      className={clsx(
                        "flex min-w-0 items-center gap-2 text-xs leading-4 whitespace-nowrap",
                        TEXT_MUTED,
                      )}
                    >
                      <span className="font-mono font-semibold text-gray-900 dark:text-white">
                        {formatCount(group.count)}{" "}
                        {group.count === 1 ? "job" : "jobs"}
                      </span>
                      <span aria-hidden="true" className={TEXT_FAINT}>
                        ·
                      </span>
                      <span
                        title={formatAbsoluteTimestamp(group.lastSeen, "full")}
                      >
                        {formatAgo(group.lastSeen, now)}
                      </span>
                      {isNewGroup(group) ? (
                        <span
                          className={clsx(
                            NEW_PILL,
                            "inline-flex h-5 items-center px-[7px]",
                          )}
                        >
                          New
                        </span>
                      ) : null}
                    </span>
                    <HourlySpark hourly={group.hourly} />
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="overflow-x-auto max-sm:hidden">
            <div
              role="table"
              aria-label={`Errors in ${queue?.displayName ?? queueName}`}
              className="min-w-[840px] overflow-hidden rounded-xl border border-gray-200/70 tabular-nums dark:border-slate-800"
            >
              <div
                role="row"
                className="grid h-9 items-center border-b border-gray-200/70 bg-gray-50 text-xs text-gray-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400"
                style={{ gridTemplateColumns: GRID_COLUMNS }}
              >
                <div role="columnheader" className="px-3.5">
                  Error
                </div>
                <div role="columnheader" className="px-3.5 text-right">
                  Jobs
                </div>
                <div role="columnheader" className="px-3.5">
                  Last 24 hours
                </div>
                <div role="columnheader" className="px-3.5">
                  Last seen
                </div>
                <div role="columnheader" className="sr-only">
                  Actions
                </div>
              </div>
              {groups.map((group) => {
                const isNew = isNewGroup(group);
                const label = formatErrorLabel(group);
                return (
                  <div
                    key={group.fingerprint}
                    role="row"
                    tabIndex={0}
                    aria-label={`${label}. ${formatCount(group.count)} failed ${
                      group.count === 1 ? "job" : "jobs"
                    }. Press Enter to show them`}
                    onClick={() => onOpenGroup(group)}
                    onKeyDown={(event: KeyboardEvent) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenGroup(group);
                      }
                    }}
                    className={clsx(
                      "group/row grid min-h-16 cursor-pointer items-center border-b border-gray-100/80 py-2.5 transition-colors duration-150 last:border-b-0 hover:bg-gray-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40",
                      FOCUS_RING_INSET,
                    )}
                    style={{ gridTemplateColumns: GRID_COLUMNS }}
                  >
                    <div role="cell" className="min-w-0 px-3.5">
                      <p className="font-mono text-[12.5px] leading-5 break-words text-gray-900 dark:text-white">
                        <ErrorMessage
                          type={group.type}
                          message={group.message}
                        />
                      </p>
                      {group.frame || isNew ? (
                        <p
                          className={clsx(
                            "mt-1 flex flex-wrap items-center gap-2 font-mono text-[11.5px]",
                            TEXT_MUTED,
                          )}
                        >
                          {group.frame ? <span>{group.frame}</span> : null}
                          {isNew ? (
                            <span
                              className={clsx(NEW_PILL, "px-1.5 leading-4")}
                            >
                              New
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                    </div>
                    <div
                      role="cell"
                      className="px-3.5 text-right font-mono text-[13px] text-gray-900 dark:text-white"
                    >
                      {formatCount(group.count)}
                    </div>
                    <div role="cell" className="px-3.5">
                      <HourlyBars hourly={group.hourly} />
                    </div>
                    <div
                      role="cell"
                      className={clsx("px-3.5 text-xs", TEXT_MUTED)}
                    >
                      <span
                        className="block font-medium text-gray-700 dark:text-slate-200"
                        title={formatAbsoluteTimestamp(group.lastSeen, "full")}
                      >
                        {formatAgo(group.lastSeen, now)}
                      </span>
                      <span
                        title={formatAbsoluteTimestamp(group.firstSeen, "full")}
                      >
                        first {formatAgo(group.firstSeen, now)}
                      </span>
                    </div>
                    <div
                      role="cell"
                      className="flex justify-end gap-1.5 px-3.5 opacity-0 transition-opacity duration-150 group-focus-within/row:opacity-100 group-hover/row:opacity-100 max-lg:opacity-100"
                      // The actions confirm first, and a click on one must not
                      // also open the group.
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      {canRetry ? (
                        <Alert
                          isPending={retryByFilter.isPending}
                          title={`Retry ${formatCount(group.count)} failed ${
                            group.count === 1 ? "job" : "jobs"
                          }?`}
                          description={`Every failed job in this group found within the scan limit moves back to waiting: ${label}`}
                          action={
                            <Button
                              variant="filled"
                              colorScheme="brand"
                              label="Yes, retry them"
                              onClick={() =>
                                retryByFilter.mutate({
                                  queueName,
                                  status: "failed",
                                  error: group.fingerprint,
                                })
                              }
                            />
                          }
                        >
                          <Button
                            as="span"
                            size="sm"
                            icon={<RotateCw className="size-3.5" />}
                            label="Retry all"
                          />
                        </Alert>
                      ) : null}
                      {canRemove ? (
                        <Alert
                          isPending={removeByFilter.isPending}
                          title={`Remove ${formatCount(group.count)} failed ${
                            group.count === 1 ? "job" : "jobs"
                          }?`}
                          description={`This can't be undone. Every failed job in this group found within the scan limit is removed: ${label}`}
                          action={
                            <Button
                              variant="filled"
                              colorScheme="red"
                              label="Yes, remove them"
                              onClick={() =>
                                removeByFilter.mutate({
                                  queueName,
                                  status: "failed",
                                  error: group.fingerprint,
                                })
                              }
                            />
                          }
                        >
                          <span
                            className="inline-flex size-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-colors duration-150 hover:border-gray-300 hover:bg-gray-50 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:bg-slate-800"
                            aria-label={`Remove all ${formatCount(group.count)}`}
                          >
                            <Trash2 aria-hidden="true" className="size-3.5" />
                          </span>
                        </Alert>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <div
          className={clsx(
            "rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm dark:border-slate-800",
            TEXT_MUTED,
          )}
        >
          {range === "all"
            ? "Failed jobs this queue keeps show up here, grouped by what went wrong."
            : "Nothing failed in this range. Widen it to see older failures."}
        </div>
      )}

      {data && data.scanned > 0 ? (
        <div
          className={clsx(
            "space-y-1 text-xs max-sm:leading-[18px]",
            // The cards' last hairline, since each card only draws its top.
            groups.length > 0 && "max-sm:border-t max-sm:pt-3",
            groups.length > 0 && PHONE_HAIRLINE,
            TEXT_MUTED,
          )}
        >
          <p className="max-sm:hidden">
            Grouped from the {formatCount(data.scanned)} failed{" "}
            {data.scanned === 1 ? "job" : "jobs"} this queue keeps
            {data.scanLimitReached ? ", the newest it could read" : ""}. Jobs
            removed on failure (<code className="font-mono">removeOnFail</code>)
            aren't counted.
          </p>
          {/* Its own paragraph rather than a phone-only span in the one
              above: splitting that text run moved its glyphs by a fraction
              of a pixel on desktop. */}
          <p className="sm:hidden">
            Grouped from the {formatCount(data.scanned)} failed{" "}
            {data.scanned === 1 ? "job" : "jobs"} this queue keeps
            {data.scanLimitReached ? ", the newest it could read" : ""}.{" "}
            {groups.length > 0 ? (
              tapHint
            ) : (
              <>
                Jobs removed on failure (
                <code className="font-mono">removeOnFail</code>) aren't counted.
              </>
            )}
          </p>
          <p>
            Queuedash Pro keeps error history past that, and alerts on new or
            spiking errors.
          </p>
        </div>
      ) : null}
    </div>
  );
};

/** The filter the Jobs view shows while listing one error group. */
export const ErrorFilterChip = ({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) => (
  <span className="inline-flex h-9 max-w-full min-w-0 shrink items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 pr-1 pl-2.5 text-xs font-medium text-red-700 sm:max-w-[45%] dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400">
    <span className="truncate" title={label}>
      {label}
    </span>
    <button
      type="button"
      onClick={onClear}
      aria-label="Stop filtering by this error"
      className={clsx(
        "grid size-6 shrink-0 place-items-center rounded-md transition-colors duration-150 hover:bg-red-100 dark:hover:bg-red-950",
        FOCUS_RING,
      )}
    >
      <X aria-hidden="true" className="size-3.5" />
    </button>
  </span>
);
