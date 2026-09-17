import { keepPreviousData } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";

import { formatCount, formatCountLabel } from "../utils/format";
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
import { WorkersPanel, workersSummary } from "./WorkersPanel";

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

/** Decoration for the number beside it; it drops out where a cell is narrow. */
const MetricSparkline = ({
  data,
  color,
}: {
  data: number[];
  color: string;
}) => (
  <div aria-hidden="true" className="hidden w-16 shrink-0 pb-1 xl:block">
    <Sparkline data={data} color={color} height={20} />
  </div>
);

const calculateTrend = (current: number, previous: number) => {
  if (previous === 0) return null;
  const change = ((current - previous) / previous) * 100;
  return { change, isPositive: change >= 0 };
};

const MetricCells = ({
  queueName,
  timeRange,
}: {
  queueName: string;
  timeRange: TimeRange;
}) => {
  const { preferences } = useQueuedash();
  const minutes = TIME_RANGES[timeRange].minutes;

  const { data: completedMetrics, isPlaceholderData: isCompletedStale } =
    trpc.queue.metrics.useQuery(
      { queueName, type: "completed", start: 0, end: minutes },
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
      { queueName, type: "failed", start: 0, end: minutes },
      {
        enabled: !!queueName,
        refetchInterval: preferences.refreshIntervalMs,
        placeholderData: keepPreviousData,
      },
    );

  if (!completedMetrics && !failedMetrics) {
    return (
      <>
        {[...Array(3)].map((_, i) => (
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
  const successRate =
    totalCount > 0 ? (completedCount / totalCount) * 100 : null;
  const prevTotalCount =
    (completedMetrics?.meta.prevCount ?? 0) +
    (failedMetrics?.meta.prevCount ?? 0);
  const prevSuccessRate =
    completedMetrics && prevTotalCount > 0
      ? (completedMetrics.meta.prevCount / prevTotalCount) * 100
      : null;
  const successRateTrend =
    successRate !== null && prevSuccessRate !== null
      ? {
          change: successRate - prevSuccessRate,
          isPositive: successRate >= prevSuccessRate,
        }
      : null;
  const completedTrend = completedMetrics
    ? calculateTrend(completedMetrics.count, completedMetrics.meta.prevCount)
    : null;
  const failedTrend = failedMetrics
    ? calculateTrend(failedMetrics.count, failedMetrics.meta.prevCount)
    : null;
  const throughput =
    totalCount > 0 ? (completedCount / minutes).toFixed(1) : null;
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
        aside={<MetricSparkline data={successRateSparkline} color="#22c55e" />}
      />
      <StatCell
        isStale={isStale}
        label="Throughput"
        value={throughput === null ? "—" : `${throughput}/min`}
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
          />
        }
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
          <MetricSparkline data={failedMetrics?.data || []} color="#f04438" />
        }
      />
    </>
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

  if (queue && !supportsMetrics && !supportsWorkers) return null;

  const cellCount = queue
    ? (supportsMetrics ? 3 : 0) + (supportsWorkers ? 1 : 0)
    : 3;
  const hasPendingWork = queue
    ? queue.counts.waiting + queue.counts.active > 0
    : false;

  return (
    <StatStrip
      label="Health"
      ariaLabel="Queue health"
      columns={cellCount as 1 | 2 | 3 | 4}
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
      {!queue || supportsMetrics ? (
        <MetricCells queueName={queueName} timeRange={timeRange} />
      ) : null}
      {supportsWorkers ? (
        <WorkersCell queueName={queueName} hasPendingWork={hasPendingWork} />
      ) : null}
    </StatStrip>
  );
};
