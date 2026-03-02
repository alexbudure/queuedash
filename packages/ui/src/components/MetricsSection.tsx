import { useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { trpc } from "../utils/trpc";
import { Sparkline } from "./Sparkline";
import { REFETCH_INTERVAL } from "../utils/config";

type MetricsSectionProps = {
  queueName: string;
};

type TimeRange = "1m" | "1h" | "24h" | "7d";

const TIME_RANGES: Record<TimeRange, { label: string; minutes: number }> = {
  "1m": { label: "Last minute", minutes: 1 },
  "1h": { label: "Last hour", minutes: 60 },
  "24h": { label: "Last 24 hours", minutes: 1440 },
  "7d": { label: "Last 7 days", minutes: 10080 },
};

const TrendIndicator = ({
  trend,
  inverted = false,
}: {
  trend: { change: number; isPositive: boolean } | null;
  inverted?: boolean;
}) => {
  if (!trend || Math.abs(trend.change) < 0.1) return null;

  // For inverted metrics (like failures), down is good
  const isGood = inverted ? !trend.isPositive : trend.isPositive;
  const Icon = trend.isPositive ? TrendingUp : TrendingDown;
  const colorClass = isGood ? "text-green-600" : "text-red-600";

  return (
    <div className={`flex items-center gap-1 ${colorClass}`}>
      <Icon className="size-3" />
      <span className="font-mono text-xs font-medium">
        {Math.abs(trend.change).toFixed(1)}%
      </span>
    </div>
  );
};

export const MetricsSection = ({ queueName }: MetricsSectionProps) => {
  const [timeRange, setTimeRange] = useState<TimeRange>("1h");

  const { data: completedMetrics, isLoading: isLoadingCompleted } =
    trpc.queue.metrics.useQuery(
      {
        queueName,
        type: "completed",
        start: 0,
        end: TIME_RANGES[timeRange].minutes,
      },
      {
        enabled: !!queueName,
        refetchInterval: REFETCH_INTERVAL,
      },
    );

  const { data: failedMetrics, isLoading: isLoadingFailed } =
    trpc.queue.metrics.useQuery(
      {
        queueName,
        type: "failed",
        start: 0,
        end: TIME_RANGES[timeRange].minutes,
      },
      {
        enabled: !!queueName,
        refetchInterval: REFETCH_INTERVAL,
      },
    );

  const isLoading = isLoadingCompleted || isLoadingFailed;

  // Calculate trends (compare to previous period)
  const calculateTrend = (current: number, previous: number) => {
    if (previous === 0) return null;
    const change = ((current - previous) / previous) * 100;
    return {
      change,
      isPositive: change >= 0,
    };
  };

  const completedTrend = completedMetrics
    ? calculateTrend(completedMetrics.count, completedMetrics.meta.prevCount)
    : null;

  const failedTrend = failedMetrics
    ? calculateTrend(failedMetrics.count, failedMetrics.meta.prevCount)
    : null;

  const completedCount = completedMetrics?.count || 0;
  const failedCount = failedMetrics?.count || 0;
  const totalCount = completedCount + failedCount;

  const successRate =
    totalCount > 0 ? ((completedCount / totalCount) * 100).toFixed(1) : "100.0";

  const throughput = completedMetrics
    ? (completedMetrics.count / TIME_RANGES[timeRange].minutes).toFixed(1)
    : "0";

  // Build success rate sparkline from completed + failed data arrays
  const successRateSparkline =
    completedMetrics?.data && failedMetrics?.data
      ? completedMetrics.data.map((c, i) => {
          const f = failedMetrics.data[i] || 0;
          const total = c + f;
          return total > 0 ? (c / total) * 100 : 100;
        })
      : [];

  const timeRangeKeys = Object.keys(TIME_RANGES) as TimeRange[];

  return (
    <div className="space-y-4">
      <div
        className="flex w-fit gap-1 rounded-lg border border-gray-100/60 p-0.5 dark:border-slate-800/60"
        role="radiogroup"
        aria-label="Time range"
      >
        {timeRangeKeys.map((range) => (
          <button
            key={range}
            role="radio"
            aria-checked={timeRange === range}
            onClick={() => setTimeRange(range)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium outline-none transition-colors ${
              timeRange === range
                ? "bg-gray-100 text-gray-900 dark:bg-slate-800 dark:text-slate-100"
                : "text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
            }`}
          >
            {TIME_RANGES[range].label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i}>
              <div className="h-4 w-16 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
              <div className="mt-1 h-7 w-16 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
              <div className="mt-0.5 h-4 w-12 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
              <div className="mt-2 h-6 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {/* Success Rate */}
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Success Rate
            </p>
            <div className="mt-1 flex items-baseline gap-1.5">
              <div className="font-mono text-xl font-semibold text-slate-900 dark:text-white">
                {successRate}%
              </div>
              <TrendIndicator
                trend={
                  failedTrend
                    ? {
                        change: failedTrend.change,
                        isPositive: !failedTrend.isPositive,
                      }
                    : null
                }
              />
            </div>
            <div className="mt-0.5 font-mono text-xs text-slate-400 dark:text-slate-500">
              {completedCount}/{totalCount}
            </div>
            {successRateSparkline.length >= 2 ? (
              <div className="mt-2">
                <Sparkline
                  data={successRateSparkline}
                  color="#22c55e"
                  height={24}
                />
              </div>
            ) : null}
          </div>

          {/* Throughput */}
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Throughput
            </p>
            <div className="mt-1 flex items-baseline gap-1.5">
              <div className="font-mono text-xl font-semibold text-slate-900 dark:text-white">
                {throughput}/min
              </div>
              <TrendIndicator trend={completedTrend} />
            </div>
            <div className="mt-0.5 font-mono text-xs text-slate-400 dark:text-slate-500">
              {completedCount} jobs
            </div>
            {(completedMetrics?.data || []).length >= 2 ? (
              <div className="mt-2">
                <Sparkline
                  data={completedMetrics?.data || []}
                  color="#3b82f6"
                  height={24}
                />
              </div>
            ) : null}
          </div>

          {/* Completed */}
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Completed
            </p>
            <div className="mt-1 flex items-baseline gap-1.5">
              <div className="font-mono text-xl font-semibold text-slate-900 dark:text-white">
                {completedCount.toLocaleString()}
              </div>
              <TrendIndicator trend={completedTrend} />
            </div>
            <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
              in period
            </div>
            {(completedMetrics?.data || []).length >= 2 ? (
              <div className="mt-2">
                <Sparkline
                  data={completedMetrics?.data || []}
                  color="#22c55e"
                  height={24}
                />
              </div>
            ) : null}
          </div>

          {/* Failed */}
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Failed</p>
            <div className="mt-1 flex items-baseline gap-1.5">
              <div className="font-mono text-xl font-semibold text-slate-900 dark:text-white">
                {failedCount.toLocaleString()}
              </div>
              <TrendIndicator trend={failedTrend} inverted />
            </div>
            <div className="mt-0.5 font-mono text-xs text-slate-400 dark:text-slate-500">
              {totalCount > 0
                ? ((failedCount / totalCount) * 100).toFixed(1)
                : "0.0"}
              % rate
            </div>
            {(failedMetrics?.data || []).length >= 2 ? (
              <div className="mt-2">
                <Sparkline
                  data={failedMetrics?.data || []}
                  color="#f04438"
                  height={24}
                />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
