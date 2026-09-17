import { clsx } from "clsx";
import { CircleAlert, LockKeyhole, Pause } from "lucide-react";
import { useInView } from "react-intersection-observer";
import { Link } from "react-router";

import { formatCompactCount } from "../utils/format";
import { FOCUS_RING, TEXT_FAINT, TEXT_MUTED } from "../utils/styles";
import type { Queue } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { getQueuePath } from "../utils/viewState";
import { useQueuedash } from "./QueuedashProvider";
import { Skeleton } from "./Skeleton";
import { Sparkline } from "./Sparkline";

const statConfig = [
  {
    key: "completed",
    label: "Completed",
    status: undefined,
  },
  {
    key: "failed",
    label: "Failed",
    status: "failed",
  },
  {
    key: "active",
    label: "Active",
    status: "active",
  },
  {
    key: "waiting",
    label: "Waiting",
    status: "waiting",
  },
] as const;

export const OVERVIEW_STAT_LABELS = statConfig.map((stat) => stat.label);

/**
 * The stat columns. Fixed tracks rather than `justify-end`, because with the
 * icon packed inside a right-aligned group its x-position followed the width of
 * the number beside it - twenty rows down, four icon columns zig-zagged while
 * the numbers stayed straight. HomePage's header row draws from the same
 * template so the labels sit over the numbers they name.
 */
export const OVERVIEW_STATS_GRID =
  "grid shrink-0 grid-cols-[repeat(4,3rem)] gap-3 sm:grid-cols-[repeat(4,4rem)] sm:gap-4";

/**
 * Numbers only. A per-row glyph sat 4px from a right-aligned number box, so on
 * the common single-digit row the icon rendered ~56px from its own value and
 * 12px from the next column's - it grouped with the wrong number. The header
 * row names each column once, which is what the icons were standing in for.
 */
const STAT_CELL = "flex items-center justify-end";

/**
 * Rows bleed 12px past the content edge so the hover fill has a margin while
 * the queue name lines up with the page title above it. Anything a row has to
 * say (read-only, paused, unavailable) trails the name as a glyph.
 */
const ROW_CLASS = "-mx-3 flex min-h-10 items-center gap-4 px-3 py-2.5";

type OverviewQueueCardProps = {
  queueName: string;
  /** Fetched by the page for every queue at once, so the fleet can be summed. */
  queue: Queue | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  isRetrying: boolean;
};

export const OverviewQueueCard = ({
  queueName,
  queue,
  isLoading,
  isError,
  onRetry,
  isRetrying,
}: OverviewQueueCardProps) => {
  const { preferences } = useQueuedash();
  // The sparklines are two more queries per row, so they still wait until the
  // row is near the viewport.
  const { ref: visibilityRef, inView } = useInView({
    rootMargin: "400px 0px",
  });

  const supportsMetrics =
    queue?.supports.metrics === true && preferences.showOverviewMetrics;

  const { data: completedMetrics } = trpc.queue.metrics.useQuery(
    { queueName, type: "completed", start: 0, end: 60 },
    {
      enabled: inView && supportsMetrics,
      refetchInterval: preferences.refreshIntervalMs,
    },
  );

  const { data: failedMetrics } = trpc.queue.metrics.useQuery(
    { queueName, type: "failed", start: 0, end: 60 },
    {
      enabled: inView && supportsMetrics,
      refetchInterval: preferences.refreshIntervalMs,
    },
  );

  if (isLoading) {
    return (
      <div ref={visibilityRef} className={ROW_CLASS}>
        <Skeleton className="h-5 flex-1 rounded" />
      </div>
    );
  }

  // A queue that fails to load used to render as an unlabelled 40px gap, so a
  // broken queue simply vanished from the overview - and when Redis is down,
  // so did all of them. Keep the identity and offer a way back.
  if (isError || !queue) {
    return (
      <div ref={visibilityRef} className={clsx(ROW_CLASS, "gap-2.5")}>
        <h3
          className="truncate text-sm font-medium text-gray-900 dark:text-white"
          title={queueName}
        >
          {queueName}
        </h3>
        <CircleAlert
          aria-hidden="true"
          className="size-3.5 shrink-0 text-red-500 dark:text-red-400"
        />
        <span className={clsx("shrink-0 text-xs", TEXT_MUTED)}>
          Unavailable
        </span>
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className={clsx(
            "ml-auto shrink-0 rounded-full px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 active:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800 dark:active:bg-slate-700",
            FOCUS_RING,
          )}
        >
          {isRetrying ? "Retrying…" : "Retry"}
        </button>
      </div>
    );
  }

  const completedData = completedMetrics?.data ?? [];
  const failedData = failedMetrics?.data ?? [];
  // One domain across both charts: a failure spike of 2 must not draw the same
  // amplitude as 20,000 completions.
  const sparklineMax = Math.max(0, ...completedData, ...failedData);

  const queuePath = getQueuePath(queue.name);

  return (
    <div
      ref={visibilityRef}
      className={clsx(
        ROW_CLASS,
        "relative transition-colors hover:bg-gray-100/60 has-[a:active]:bg-gray-100 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-brand-400 has-[a:focus-visible]:ring-inset dark:hover:bg-slate-800/50 dark:has-[a:active]:bg-slate-800 dark:has-[a:focus-visible]:ring-brand-600",
      )}
    >
      {/* Queue name */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <h3 className="min-w-0 truncate text-sm font-medium text-gray-900 dark:text-white">
          <Link
            to={queuePath}
            title={queue.displayName}
            className="outline-none after:absolute after:inset-0"
          >
            {queue.displayName}
          </Link>
        </h3>
        {/* The same glyph the sidebar uses, so one queue is marked one way. */}
        {queue.access.mode === "read-only" ? (
          <span title="Read-only" className="flex shrink-0">
            <LockKeyhole
              aria-hidden="true"
              className={clsx("size-3", TEXT_FAINT)}
            />
            <span className="sr-only">(read-only)</span>
          </span>
        ) : null}
        {/* Neutral, not amber: amber already means "waiting" two columns over. */}
        {queue.paused && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-gray-100 px-2 py-px text-[10px] font-medium text-gray-600 dark:bg-slate-800 dark:text-slate-300">
            <Pause aria-hidden="true" className="size-2.5" />
            Paused
          </span>
        )}
      </div>

      {/* Sparklines are decoration for the numbers beside them, and at 375px
          the fixed 112px they occupy is what pushes this row off screen. */}
      {supportsMetrics ? (
        <div
          aria-hidden="true"
          className="hidden w-28 shrink-0 items-center gap-1.5 sm:flex"
        >
          <Sparkline
            data={completedData}
            color="#22c55e"
            height={24}
            domainMax={sparklineMax}
          />
          <Sparkline
            data={failedData}
            color="#f04438"
            height={24}
            domainMax={sparklineMax}
          />
        </div>
      ) : null}

      {/* Stats */}
      <div className={OVERVIEW_STATS_GRID}>
        {statConfig.map((stat) => {
          const count = queue.counts[stat.key];
          const isZero = !count;
          const body = (
            <>
              {/* The header row is decorative, so the row keeps its own labels. */}
              <span className="sr-only">{stat.label}: </span>
              <span
                className={clsx(
                  "truncate text-right font-mono text-xs tabular-nums",
                  isZero && TEXT_FAINT,
                  !isZero &&
                    (stat.key === "failed"
                      ? "font-semibold text-red-600 dark:text-red-400"
                      : "text-gray-700 dark:text-slate-200"),
                )}
              >
                {formatCompactCount(count)}
              </span>
            </>
          );

          // Landing on the queue's default tab when you clicked "12 failed" is
          // the long way round to the thing you were looking at.
          return stat.status ? (
            <Link
              key={stat.key}
              to={`${queuePath}?status=${stat.status}`}
              className={clsx(
                STAT_CELL,
                // The negative margins bleed the hover background past the
                // track without moving the track itself, so the columns still
                // line up while the tap target reaches 24px.
                "relative z-10 -mx-1 -my-1 rounded px-1 py-1 transition-colors hover:bg-gray-200/70 active:bg-gray-300/70 dark:hover:bg-slate-700 dark:active:bg-slate-600",
                FOCUS_RING,
              )}
            >
              {body}
            </Link>
          ) : (
            <span key={stat.key} className={STAT_CELL}>
              {body}
            </span>
          );
        })}
      </div>
    </div>
  );
};
