import { useState } from "react";
import { trpc } from "../utils/trpc";
import { MetricsCard } from "./MetricsCard";
import { Skeleton } from "./Skeleton";
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
      value: Math.round(Math.abs(change)),
      isPositive: change > 0,
    };
  };

  const completedTrend =
    completedMetrics &&
    calculateTrend(completedMetrics.count, completedMetrics.meta.prevCount);

  const failedTrend =
    failedMetrics &&
    calculateTrend(failedMetrics.count, failedMetrics.meta.prevCount);

  // Calculate rate (jobs per minute)
  const completedRate = completedMetrics
    ? (completedMetrics.count / TIME_RANGES[timeRange].minutes).toFixed(1)
    : "0";

  const failedRate = failedMetrics
    ? (failedMetrics.count / TIME_RANGES[timeRange].minutes).toFixed(1)
    : "0";

  const successRate =
    completedMetrics && failedMetrics
      ? completedMetrics.count + failedMetrics.count > 0
        ? (
            (completedMetrics.count /
              (completedMetrics.count + failedMetrics.count)) *
            100
          ).toFixed(1)
        : "100"
      : "0";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Metrics
        </h2>
        <div className="flex items-center space-x-0.5 rounded-lg border border-slate-200/80 bg-white/80 p-0.5 backdrop-blur-sm dark:border-slate-700/50 dark:bg-slate-900/50">
          {(Object.keys(TIME_RANGES) as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150 ${
                timeRange === range
                  ? "bg-slate-100 text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-100"
              }`}
            >
              {TIME_RANGES[range].label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-[88px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricsCard
            label="Completed"
            value={completedMetrics?.count || 0}
            trend={completedTrend || undefined}
            variant="completed"
          />
          <MetricsCard
            label="Failed"
            value={failedMetrics?.count || 0}
            trend={failedTrend || undefined}
            variant="failed"
          />
          <MetricsCard
            label="Success Rate"
            value={`${successRate}%`}
          />
          <MetricsCard
            label="Throughput"
            value={`${completedRate}/min`}
          />
        </div>
      )}
    </div>
  );
};
