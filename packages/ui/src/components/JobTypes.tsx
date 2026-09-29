import { keepPreviousData } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ChevronRight } from "lucide-react";
import { type KeyboardEvent, useState } from "react";

import { NUM_OF_RETRIES } from "../utils/config";
import { formatCount, formatDuration } from "../utils/format";
import { FOCUS_RING_INSET, TEXT_FAINT, TEXT_MUTED } from "../utils/styles";
import type { Queue, RouterOutput } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { ErrorCard } from "./ErrorCard";
import { PHONE_SELECT } from "./phoneStyles";
import { useQueuedash } from "./QueuedashProvider";
import { Select, type SelectOption } from "./Select";
import { Skeleton } from "./Skeleton";
import { formatAbsoluteTimestamp, formatRelativeTimestamp } from "./Timestamp";

export type JobType = RouterOutput["job"]["types"]["types"][number];
export type JobTypeRange = "1h" | "24h" | "7d";
type JobTypeSort = "runs" | "failures" | "slowest" | "recent";

const RANGES: Record<JobTypeRange, { label: string; minutes: number }> = {
  "1h": { label: "Last hour", minutes: 60 },
  "24h": { label: "Last 24 hours", minutes: 1_440 },
  "7d": { label: "Last 7 days", minutes: 10_080 },
};

const RANGE_OPTIONS: ReadonlyArray<SelectOption<JobTypeRange>> = (
  Object.keys(RANGES) as JobTypeRange[]
).map((value) => ({ label: RANGES[value].label, value }));

const RANGE_PHRASES: Record<JobTypeRange, string> = {
  "1h": "in the last hour",
  "24h": "in the last 24 hours",
  "7d": "in the last 7 days",
};

const SORTS: ReadonlyArray<SelectOption<JobTypeSort>> = [
  { label: "Most runs", value: "runs" },
  { label: "Most failures", value: "failures" },
  { label: "Slowest", value: "slowest" },
  { label: "Last run", value: "recent" },
];

export const isJobTypeRange = (value: string | null): value is JobTypeRange =>
  value === "1h" || value === "24h" || value === "7d";

// The server rescans at most every ten seconds; polling faster would only
// re-read its cache.
const MIN_REFRESH_MS = 10_000;

const GRID_COLUMNS = "minmax(0,1fr) 88px 128px 88px 88px 132px 28px";

const runsOf = (type: JobType) => type.completed + type.failed;

const sortTypes = (types: JobType[], sort: JobTypeSort) =>
  [...types].sort((left, right) => {
    switch (sort) {
      case "failures":
        return (
          right.failureRate - left.failureRate || right.failed - left.failed
        );
      case "slowest":
        return (right.p95 ?? -1) - (left.p95 ?? -1);
      case "recent":
        return right.lastFinishedAt - left.lastFinishedAt;
      default:
        return runsOf(right) - runsOf(left);
    }
  });

/** Bull names a job added without one `__default__`. */
export const formatJobTypeName = (name: string) =>
  name === "__default__" ? "Unnamed" : name;

const formatRate = (rate: number) =>
  rate === 0
    ? "0%"
    : rate < 0.001
      ? "<0.1%"
      : `${(Math.round(rate * 1_000) / 10).toFixed(rate < 0.1 ? 1 : 0)}%`;

/** The failed share as a thin bar, so a column of rates scans at a glance. */
const FailureRate = ({ type }: { type: JobType }) => (
  <span className="flex min-w-0 items-center gap-2">
    <span
      className={clsx(
        "w-11 shrink-0 text-right font-mono text-[13px]",
        type.failed > 0 ? "text-red-600 dark:text-red-400" : TEXT_MUTED,
      )}
    >
      {formatRate(type.failureRate)}
    </span>
    <span
      aria-hidden="true"
      className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"
    >
      {type.failed > 0 ? (
        <span
          className="block h-full rounded-full bg-red-500 dark:bg-red-400"
          style={{ width: `${Math.max(4, type.failureRate * 100)}%` }}
        />
      ) : null}
    </span>
  </span>
);

/**
 * The kinds of job a queue runs, by the name each was added under: how often
 * each ran in the window, how often it failed, and how long its runs took.
 * A row opens the job list for that name.
 */
export const JobTypes = ({
  queueName,
  queue,
  range,
  onRangeChange,
  onOpenType,
}: {
  queueName: string;
  queue: Queue | undefined;
  range: JobTypeRange;
  onRangeChange: (range: JobTypeRange) => void;
  onOpenType: (type: JobType) => void;
}) => {
  const { preferences } = useQueuedash();
  const [sort, setSort] = useState<JobTypeSort>("runs");
  const typesReq = trpc.job.types.useQuery(
    { queueName, minutes: RANGES[range].minutes },
    {
      enabled: !!queue?.supports.jobNames,
      refetchInterval:
        preferences.refreshIntervalMs === false
          ? false
          : Math.max(preferences.refreshIntervalMs, MIN_REFRESH_MS),
      retry: NUM_OF_RETRIES,
      placeholderData: keepPreviousData,
    },
  );

  if (typesReq.isError) {
    return (
      <ErrorCard
        title="Could not read job types"
        message={typesReq.error.message}
        onRetry={() => typesReq.refetch()}
        isRetrying={typesReq.isRefetching}
      />
    );
  }

  const data = typesReq.data;
  const types = data ? sortTypes(data.types, sort) : [];
  const totalRuns = types.reduce((sum, type) => sum + runsOf(type), 0);
  const now = data?.now ?? Date.now();
  const openOnKey = (type: JobType) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenType(type);
    }
  };

  return (
    <div
      className={clsx(
        "space-y-3 transition-opacity duration-150",
        typesReq.isPlaceholderData && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="min-w-0 flex-1 text-sm text-gray-700 max-sm:basis-full dark:text-slate-300">
          {!data ? (
            <Skeleton className="h-4 w-56 rounded" />
          ) : types.length > 0 ? (
            <>
              <b className="font-semibold text-gray-900 dark:text-white">
                {formatCount(types.length)}{" "}
                {types.length === 1 ? "job type" : "job types"}
              </b>{" "}
              ran {formatCount(totalRuns)} {totalRuns === 1 ? "time" : "times"}{" "}
              {RANGE_PHRASES[range]}
            </>
          ) : (
            <span className={TEXT_MUTED}>
              No jobs finished {RANGE_PHRASES[range]}.
            </span>
          )}
        </div>
        <Select<JobTypeRange>
          ariaLabel="Time range"
          className={PHONE_SELECT}
          options={RANGE_OPTIONS}
          value={range}
          onChange={onRangeChange}
        />
        <Select<JobTypeSort>
          ariaLabel="Sort job types"
          className={PHONE_SELECT}
          options={SORTS}
          value={sort}
          onChange={setSort}
        />
      </div>

      {!data ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      ) : types.length === 0 ? (
        <div
          className={clsx(
            "rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm dark:border-slate-800",
            TEXT_MUTED,
          )}
        >
          Each kind of job this queue runs shows up here once one finishes.
          Widen the range to see older runs.
        </div>
      ) : (
        <>
          {/* Wider screens: one row per type, every number in its column. */}
          <div
            role="table"
            aria-label={`Job types in ${queue?.displayName ?? queueName}`}
            className="overflow-hidden rounded-xl border border-gray-200/70 tabular-nums max-sm:hidden dark:border-slate-800"
          >
            <div
              role="row"
              className="grid h-9 items-center border-b border-gray-200/70 bg-gray-50 text-xs text-gray-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400"
              style={{ gridTemplateColumns: GRID_COLUMNS }}
            >
              <div role="columnheader" className="px-3.5">
                Job
              </div>
              <div role="columnheader" className="px-3.5 text-right">
                Runs
              </div>
              <div role="columnheader" className="px-3.5">
                Failure rate
              </div>
              <div role="columnheader" className="px-3.5 text-right">
                p50
              </div>
              <div role="columnheader" className="px-3.5 text-right">
                p95
              </div>
              <div role="columnheader" className="px-3.5">
                Last run
              </div>
              <div role="columnheader" className="sr-only">
                Open
              </div>
            </div>
            {types.map((type) => (
              <div
                key={type.name}
                role="row"
                tabIndex={0}
                aria-label={`${formatJobTypeName(type.name)}: ${formatCount(
                  runsOf(type),
                )} runs, ${formatRate(type.failureRate)} failed. Press Enter to show its jobs`}
                onClick={() => onOpenType(type)}
                onKeyDown={openOnKey(type)}
                className={clsx(
                  "group/row grid h-12 cursor-pointer items-center border-b border-gray-100/80 transition-colors duration-150 last:border-b-0 hover:bg-gray-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40",
                  FOCUS_RING_INSET,
                )}
                style={{ gridTemplateColumns: GRID_COLUMNS }}
              >
                <div
                  role="cell"
                  className="min-w-0 truncate px-3.5 font-mono text-[13px] text-gray-900 dark:text-white"
                  title={type.name}
                >
                  {formatJobTypeName(type.name)}
                </div>
                <div
                  role="cell"
                  className="px-3.5 text-right font-mono text-[13px] text-gray-900 dark:text-white"
                >
                  {formatCount(runsOf(type))}
                </div>
                <div role="cell" className="px-3.5">
                  <FailureRate type={type} />
                </div>
                <div
                  role="cell"
                  className="px-3.5 text-right font-mono text-[13px] text-gray-700 dark:text-slate-200"
                >
                  {type.p50 === null ? "—" : formatDuration(type.p50)}
                </div>
                <div
                  role="cell"
                  className="px-3.5 text-right font-mono text-[13px] text-gray-700 dark:text-slate-200"
                >
                  {type.p95 === null ? "—" : formatDuration(type.p95)}
                </div>
                <div
                  role="cell"
                  className={clsx("truncate px-3.5 text-xs", TEXT_MUTED)}
                  title={formatAbsoluteTimestamp(type.lastFinishedAt, "full")}
                >
                  {formatRelativeTimestamp(type.lastFinishedAt, now)}
                </div>
                <div role="cell" className="flex justify-center">
                  <ChevronRight
                    aria-hidden="true"
                    className={clsx(
                      "size-4 transition-colors duration-150 group-hover/row:text-gray-600 dark:group-hover/row:text-slate-300",
                      TEXT_FAINT,
                    )}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* A phone: a card per type, the name and its runs, then the rest. */}
          <ul
            aria-label={`Job types in ${queue?.displayName ?? queueName}`}
            // The phone pages' hairline (see phoneStyles).
            className="divide-y divide-gray-200/60 border-y border-gray-200/60 sm:hidden dark:divide-slate-800/80 dark:border-slate-800/80"
          >
            {types.map((type) => (
              <li key={type.name}>
                <button
                  type="button"
                  onClick={() => onOpenType(type)}
                  className={clsx(
                    "flex w-full items-center gap-3 py-3 text-left active:bg-gray-50 dark:active:bg-slate-800/40",
                    FOCUS_RING_INSET,
                  )}
                >
                  <span className="block min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline justify-between gap-3">
                      <span className="block min-w-0 truncate font-mono text-[13px] leading-5 text-gray-900 dark:text-white">
                        {formatJobTypeName(type.name)}
                      </span>
                      <span className="block shrink-0 font-mono text-xs text-gray-700 tabular-nums dark:text-slate-200">
                        {formatCount(runsOf(type))} runs
                      </span>
                    </span>
                    <span
                      className={clsx(
                        "mt-1.5 flex items-center gap-2 text-xs whitespace-nowrap tabular-nums",
                        TEXT_MUTED,
                      )}
                    >
                      <span
                        className={
                          type.failed > 0
                            ? "text-red-600 dark:text-red-400"
                            : undefined
                        }
                      >
                        {formatRate(type.failureRate)} failed
                      </span>
                      <span aria-hidden="true" className={TEXT_FAINT}>
                        ·
                      </span>
                      <span>
                        p50 {type.p50 === null ? "—" : formatDuration(type.p50)}
                      </span>
                      <span aria-hidden="true" className={TEXT_FAINT}>
                        ·
                      </span>
                      <span className="truncate">
                        {formatRelativeTimestamp(type.lastFinishedAt, now)}
                      </span>
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className={clsx("size-4 shrink-0", TEXT_FAINT)}
                  />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {data && data.scanned > 0 ? (
        <p className={clsx("text-xs", TEXT_MUTED)}>
          Measured from the {formatCount(data.scanned)} completed and failed{" "}
          {data.scanned === 1 ? "job" : "jobs"} this queue keeps
          {data.scanLimitReached ? ", the newest it could read" : ""}. Run times
          count completed jobs only.
        </p>
      ) : null}
    </div>
  );
};
