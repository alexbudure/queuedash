import { keepPreviousData } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";

import { formatCount, formatCountLabel, formatDuration } from "../utils/format";
import {
  FOCUS_RING_INSET,
  SECTION_LABEL,
  TEXT_FAINT,
  TEXT_MUTED,
} from "../utils/styles";
import type { Queue } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { useQueuedash } from "./QueuedashProvider";
import { Select, type SelectOption } from "./Select";
import { Sparkline } from "./Sparkline";
import {
  STAT_CELL,
  STAT_SUB,
  STAT_VALUE,
  StatCell,
  StatCellSkeleton,
  StatStrip,
} from "./StatStrip";
import {
  isWaitingOnWorkers,
  WorkersPanel,
  workersSummary,
} from "./WorkersPanel";

type TimeRange = "1m" | "1h" | "24h" | "7d";

const TIME_RANGES: Record<TimeRange, { label: string; minutes: number }> = {
  "1m": { label: "Last minute", minutes: 1 },
  "1h": { label: "Last hour", minutes: 60 },
  "24h": { label: "Last 24 hours", minutes: 1440 },
  "7d": { label: "Last 7 days", minutes: 10080 },
};

const TIME_RANGE_OPTIONS: ReadonlyArray<SelectOption<TimeRange>> = (
  Object.keys(TIME_RANGES) as TimeRange[]
).map((value) => ({ label: TIME_RANGES[value].label, value }));

const EMPTY_PERIOD_LABEL = "No jobs in this period";

const TrendIndicator = ({
  trend,
  inverted = false,
  unit = "%",
}: {
  trend: { change: number; isPositive: boolean } | null;
  inverted?: boolean;
  // A rate that moves from 98% to 98.4% has not risen 0.4% - it has risen 0.4
  // percentage points, and the two are different numbers.
  unit?: "%" | "pt";
}) => {
  if (!trend || Math.abs(trend.change) < 0.1) return null;

  // For inverted metrics (like failures), down is good.
  const isGood = inverted ? !trend.isPositive : trend.isPositive;
  const Icon = trend.isPositive ? TrendingUp : TrendingDown;

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-0.5 font-mono text-[11px] font-medium whitespace-nowrap",
        isGood
          ? "text-green-700 dark:text-green-400"
          : "text-red-600 dark:text-red-400",
      )}
    >
      <Icon className="size-3" />
      {unit === "pt"
        ? `${trend.isPositive ? "+" : "−"}${Math.abs(trend.change).toFixed(1)} pt`
        : `${Math.abs(trend.change).toFixed(1)}%`}
    </span>
  );
};

/** Where a sparkline has room: five cells to a row need a wider screen. */
type SparklineFrom = "xl" | "2xl";

/** Decoration for the number beside it; it drops out where a cell is narrow. */
const MetricSparkline = ({
  data,
  color,
  from,
}: {
  data: number[];
  color: string;
  from: SparklineFrom;
}) => (
  <div
    aria-hidden="true"
    className={clsx(
      "hidden w-16 shrink-0 pb-1",
      from === "2xl" ? "2xl:block" : "xl:block",
    )}
  >
    <Sparkline data={data} color={color} height={20} />
  </div>
);

/**
 * Against the window of the same length just before this one. No baseline, no
 * trend: a window the queue's history does not reach, or one where nothing
 * finished, would read as growth from nothing.
 */
// A slow queue rounded to "0.0/min" even after running hundreds of jobs over a
// week, so step up to a coarser unit until the rate reads as a real number.
const formatThroughput = (perMinute: number): string => {
  if (perMinute === 0) return "0/min";
  if (perMinute >= 0.1) return `${perMinute.toFixed(1)}/min`;
  const perHour = perMinute * 60;
  if (perHour >= 0.1) return `${perHour.toFixed(1)}/h`;
  return `${(perHour * 24).toFixed(1)}/day`;
};

const calculateTrend = (current: number, previous: number | null) => {
  if (!previous) return null;
  const change = ((current - previous) / previous) * 100;
  return { change, isPositive: change >= 0 };
};

/** The completed share of everything that finished, or null if nothing did. */
const getSuccessRate = (completed: number, failed: number) => {
  const total = completed + failed;
  return total > 0 ? (completed / total) * 100 : null;
};

const MetricCells = ({
  queueName,
  timeRange,
  sparklineFrom,
}: {
  queueName: string;
  timeRange: TimeRange;
  sparklineFrom: SparklineFrom;
}) => {
  const { preferences } = useQueuedash();
  const minutes = TIME_RANGES[timeRange].minutes;
  // Complete minutes only. The current one is still filling: counting it read
  // "Last minute" as near zero at the top of every minute and dragged every
  // window down with a partial bucket.
  const metricsWindow = { start: 1, end: minutes + 1 };

  const { data: completedMetrics, isPlaceholderData: isCompletedStale } =
    trpc.queue.metrics.useQuery(
      { queueName, type: "completed", ...metricsWindow },
      {
        enabled: !!queueName,
        refetchInterval: preferences.refreshIntervalMs,
        // The range is in the query key, so without this every range change
        // destroys the numbers the user is comparing.
        placeholderData: keepPreviousData,
      },
    );

  const { data: failedMetrics, isPlaceholderData: isFailedStale } =
    trpc.queue.metrics.useQuery(
      { queueName, type: "failed", ...metricsWindow },
      {
        enabled: !!queueName,
        refetchInterval: preferences.refreshIntervalMs,
        placeholderData: keepPreviousData,
      },
    );

  if (!completedMetrics && !failedMetrics) {
    return (
      <>
        {[...Array(4)].map((_, i) => (
          <StatCellSkeleton key={i} />
        ))}
      </>
    );
  }

  const isStale = isCompletedStale || isFailedStale;
  const completedCount = completedMetrics?.count || 0;
  const failedCount = failedMetrics?.count || 0;
  const totalCount = completedCount + failedCount;

  // A queue that ran nothing has no success rate and no throughput - reporting
  // "100.0%" for it is a claim about jobs that never existed.
  const successRate = getSuccessRate(completedCount, failedCount);
  // Every baseline is the previous window, never `meta.prevCount`: that is the
  // library's running total, so trends against it read about -99% and a spike
  // of failures drew a green badge. The previous window's rate needs both of
  // its counts, or it would be a rate over half the jobs.
  const previousSuccessRate =
    completedMetrics?.previousCount != null &&
    failedMetrics?.previousCount != null
      ? getSuccessRate(
          completedMetrics.previousCount,
          failedMetrics.previousCount,
        )
      : null;
  const successRateTrend =
    successRate !== null && previousSuccessRate !== null
      ? {
          change: successRate - previousSuccessRate,
          isPositive: successRate >= previousSuccessRate,
        }
      : null;
  const completedTrend = completedMetrics
    ? calculateTrend(completedMetrics.count, completedMetrics.previousCount)
    : null;
  const failedTrend = failedMetrics
    ? calculateTrend(failedMetrics.count, failedMetrics.previousCount)
    : null;
  // Per minute the window has history for: a queue three days old has not had
  // seven days to run jobs in, and dividing by them understated its rate.
  const throughput =
    totalCount > 0
      ? formatThroughput(
          completedCount / Math.max(1, completedMetrics?.coveredMinutes ?? 0),
        )
      : null;
  const successRateSparkline =
    completedMetrics?.data && failedMetrics?.data
      ? completedMetrics.data.map((c, i) => {
          const f = failedMetrics.data[i] || 0;
          const total = c + f;
          return total > 0 ? (c / total) * 100 : 100;
        })
      : [];

  return (
    <>
      <StatCell
        isStale={isStale}
        label="Success rate"
        value={successRate === null ? "—" : `${successRate.toFixed(1)}%`}
        trend={<TrendIndicator trend={successRateTrend} unit="pt" />}
        sub={
          successRate === null
            ? EMPTY_PERIOD_LABEL
            : `${formatCount(completedCount)}/${formatCount(totalCount)}`
        }
        aside={
          <MetricSparkline
            data={successRateSparkline}
            color="#22c55e"
            from={sparklineFrom}
          />
        }
      />
      <StatCell
        isStale={isStale}
        label="Throughput"
        value={throughput ?? "—"}
        trend={<TrendIndicator trend={completedTrend} />}
        sub={
          throughput === null
            ? EMPTY_PERIOD_LABEL
            : formatCountLabel(completedCount, "job")
        }
        aside={
          <MetricSparkline
            data={completedMetrics?.data || []}
            color="#3b82f6"
            from={sparklineFrom}
          />
        }
      />
      <RunTimeCell
        queueName={queueName}
        minutes={minutes}
        sparklineFrom={sparklineFrom}
      />
      <StatCell
        isStale={isStale}
        label="Failed"
        value={formatCount(failedCount)}
        tone={failedCount > 0 ? "negative" : "neutral"}
        trend={<TrendIndicator trend={failedTrend} inverted />}
        sub={`${
          totalCount > 0 ? ((failedCount / totalCount) * 100).toFixed(1) : "0.0"
        }% rate`}
        aside={
          <MetricSparkline
            data={failedMetrics?.data || []}
            color="#f04438"
            from={sparklineFrom}
          />
        }
      />
    </>
  );
};

/** Empty slices hold the last median before them, so the line never dips to
 *  a run time of zero for a stretch where nothing finished. */
const carryForward = (values: Array<number | null>): number[] => {
  let last = values.find((value) => value !== null) ?? 0;
  return values.map((value) => {
    if (value !== null) last = value;
    return last;
  });
};

/**
 * How long the queue's jobs take: the median of the window's completed runs,
 * with the slow tail beside it. Read from job timestamps, so it answers even
 * where the library keeps no timing metrics - for the jobs it still keeps.
 */
const RunTimeCell = ({
  queueName,
  minutes,
  sparklineFrom,
}: {
  queueName: string;
  minutes: number;
  sparklineFrom: SparklineFrom;
}) => {
  const { preferences } = useQueuedash();
  const runTimesReq = trpc.job.runTimes.useQuery(
    { queueName, minutes },
    {
      // The server rescans at most every ten seconds; polling faster would
      // only re-read its cache.
      refetchInterval:
        preferences.refreshIntervalMs === false
          ? false
          : Math.max(preferences.refreshIntervalMs, 10_000),
      placeholderData: keepPreviousData,
    },
  );
  const runTimes = runTimesReq.data;
  if (!runTimes) return <StatCellSkeleton />;

  return (
    <StatCell
      isStale={runTimesReq.isPlaceholderData}
      label="Run time"
      value={runTimes.p50 === null ? "—" : formatDuration(runTimes.p50)}
      trend={
        runTimes.p50 === null ? null : (
          <span className={clsx("font-mono text-[11px]", TEXT_MUTED)}>p50</span>
        )
      }
      sub={
        runTimes.p95 === null
          ? EMPTY_PERIOD_LABEL
          : `p95 ${formatDuration(runTimes.p95)} · ${formatCountLabel(runTimes.count, "job")}`
      }
      aside={
        <MetricSparkline
          data={carryForward(runTimes.buckets)}
          color="#8b5cf6"
          from={sparklineFrom}
        />
      }
    />
  );
};

/**
 * Workers is a number with a list behind it. The cell carries the number and
 * the one state that matters (nobody is processing), and the list opens on
 * demand instead of sitting between the metrics and the jobs.
 */
const WorkersCell = ({
  queueName,
  hasPendingWork,
}: {
  queueName: string;
  hasPendingWork: boolean;
}) => {
  const { preferences } = useQueuedash();
  const [open, setOpen] = useState(false);
  const workersReq = trpc.queue.workers.useQuery(
    { queueName },
    { refetchInterval: preferences.refreshIntervalMs },
  );
  const summary = workersSummary({
    workers: workersReq.data,
    isLoading: workersReq.isLoading,
    isError: workersReq.isError,
    hasPendingWork,
  });
  const toneClass =
    summary.tone === "warning"
      ? "text-amber-600 dark:text-amber-400"
      : undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Workers: ${summary.value}, ${summary.sub}`}
        className={clsx(
          STAT_CELL,
          FOCUS_RING_INSET,
          "group/workers rounded-b-xl transition-colors duration-150 hover:bg-gray-50 active:bg-gray-100 xl:rounded-br-xl xl:rounded-bl-none dark:hover:bg-slate-800/60 dark:active:bg-slate-800",
        )}
      >
        <div className="min-w-0">
          <p className={SECTION_LABEL}>Workers</p>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              className={clsx(
                STAT_VALUE,
                toneClass ?? "text-gray-900 dark:text-white",
              )}
            >
              {summary.value}
            </span>
          </div>
          <p className={clsx(STAT_SUB, toneClass ?? TEXT_MUTED)}>
            {summary.sub}
          </p>
        </div>
        <ChevronRight
          aria-hidden="true"
          className={clsx(
            "size-4 shrink-0 self-center transition-colors duration-150 group-hover/workers:text-gray-600 dark:group-hover/workers:text-slate-300",
            TEXT_FAINT,
          )}
        />
      </button>
      {open ? (
        <WorkersPanel
          open={open}
          onOpenChange={setOpen}
          queueName={queueName}
          workers={workersReq.data}
          isLoading={workersReq.isLoading}
          isError={workersReq.isError}
          hasPendingWork={hasPendingWork}
        />
      ) : null}
    </>
  );
};

/**
 * Everything on the queue page that is *about* the queue rather than *in* it:
 * the rolling metrics and the workers serving it. One card, one row, so the
 * job list - the reason the page exists - starts right below the fold line.
 */
export const HealthStrip = ({
  queue,
  queueName,
}: {
  queue: Queue | undefined;
  queueName: string;
}) => {
  const [timeRange, setTimeRange] = useState<TimeRange>("1h");

  const supportsMetrics = queue?.supports.metrics === true;
  const supportsWorkers = queue?.supports.workers === true;

  // Without metrics there is nothing to make a strip of: one full-width cell
  // holding a worker count was a card built around a single number, so those
  // queues carry their workers in the subtitle instead.
  if (queue && !supportsMetrics) return null;

  const cellCount = supportsWorkers ? 5 : 4;
  const hasPendingWork = queue ? isWaitingOnWorkers(queue.counts) : false;

  return (
    <StatStrip
      label="Health"
      ariaLabel="Queue health"
      columns={cellCount}
      collapsibleOnPhones
      action={
        supportsMetrics ? (
          // Inside the strip because it scopes only these numbers - as a
          // page-level control it read as if it filtered the job list too.
          <Select
            ariaLabel="Metrics time range"
            size="sm"
            variant="ghost"
            options={TIME_RANGE_OPTIONS}
            value={timeRange}
            onChange={setTimeRange}
          />
        ) : null
      }
    >
      <MetricCells
        queueName={queueName}
        timeRange={timeRange}
        sparklineFrom={cellCount === 5 ? "2xl" : "xl"}
      />
      {supportsWorkers ? (
        <WorkersCell queueName={queueName} hasPendingWork={hasPendingWork} />
      ) : null}
    </StatStrip>
  );
};
