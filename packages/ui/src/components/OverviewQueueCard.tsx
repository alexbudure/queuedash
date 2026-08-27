import { CheckCircle, CircleX, Zap, Clock } from "lucide-react";
import { useInView } from "react-intersection-observer";
import { Link } from "react-router";

import { NUM_OF_RETRIES } from "../utils/config";
import { trpc } from "../utils/trpc";
import { getQueuePath } from "../utils/viewState";
import { useQueuedash } from "./QueuedashProvider";
import { Skeleton } from "./Skeleton";
import { Sparkline } from "./Sparkline";

const { format: numberFormat } = new Intl.NumberFormat("en-US");

const statConfig = [
  {
    key: "completed",
    label: "Completed",
    icon: CheckCircle,
    iconColor: "text-emerald-500 dark:text-emerald-400",
  },
  {
    key: "failed",
    label: "Failed",
    icon: CircleX,
    iconColor: "text-red-500 dark:text-red-400",
  },
  {
    key: "active",
    label: "Active",
    icon: Zap,
    iconColor: "text-blue-500 dark:text-blue-400",
  },
  {
    key: "waiting",
    label: "Waiting",
    icon: Clock,
    iconColor: "text-amber-500 dark:text-amber-400",
  },
] as const;

export const OverviewQueueCard = ({ queueName }: { queueName: string }) => {
  const { preferences } = useQueuedash();
  const { ref: visibilityRef, inView } = useInView({
    rootMargin: "400px 0px",
  });
  const { data: queue, isLoading } = trpc.queue.byName.useQuery(
    { queueName },
    {
      enabled: inView,
      refetchInterval: preferences.refreshIntervalMs,
      retry: NUM_OF_RETRIES,
    },
  );

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

  if (!inView || isLoading) {
    return (
      <div ref={visibilityRef} className="min-h-10">
        <Skeleton className="h-10 rounded-lg" />
      </div>
    );
  }

  if (!queue) return <div ref={visibilityRef} className="min-h-10" />;

  const completedData = completedMetrics?.data ?? [];
  const failedData = failedMetrics?.data ?? [];

  return (
    <Link
      ref={visibilityRef}
      to={getQueuePath(queue.name)}
      className="group flex min-h-10 items-center gap-4 rounded-lg px-3 py-2.5 transition-colors hover:bg-gray-100/60 dark:hover:bg-slate-800/50"
    >
      {/* Queue name */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <h3 className="truncate text-sm font-medium text-gray-900 dark:text-white">
          {queue.displayName}
        </h3>
        {queue.paused && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-px text-[10px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
            Paused
          </span>
        )}
      </div>

      {/* Sparklines — always reserve space so stats align across rows */}
      {supportsMetrics ? (
        <div className="flex w-28 shrink-0 items-center gap-1.5">
          {completedData.length >= 2 ? (
            <Sparkline data={completedData} color="#22c55e" height={24} />
          ) : (
            <div className="flex-1" />
          )}
          {failedData.length >= 2 ? (
            <Sparkline data={failedData} color="#f04438" height={24} />
          ) : (
            <div className="flex-1" />
          )}
        </div>
      ) : null}

      {/* Stats */}
      <div className="flex shrink-0 items-center gap-5">
        {statConfig.map((stat) => (
          <span key={stat.key} className="flex min-w-[3rem] items-center gap-1">
            <stat.icon className={`size-3 shrink-0 ${stat.iconColor}`} />
            <span className="font-mono text-xs text-gray-500 dark:text-slate-400">
              {numberFormat(queue.counts[stat.key])}
            </span>
          </span>
        ))}
      </div>
    </Link>
  );
};
