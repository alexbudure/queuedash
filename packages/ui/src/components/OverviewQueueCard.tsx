import { Link } from "react-router";
import { trpc } from "../utils/trpc";
import { NUM_OF_RETRIES, REFETCH_INTERVAL } from "../utils/config";
import { Sparkline } from "./Sparkline";
import { Skeleton } from "./Skeleton";
import { CheckCircle, CircleX, Zap, Clock } from "lucide-react";

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
  const { data: queue, isLoading } = trpc.queue.byName.useQuery(
    { queueName },
    { refetchInterval: REFETCH_INTERVAL, retry: NUM_OF_RETRIES },
  );

  const supportsMetrics = queue?.supports.metrics === true;

  const { data: completedMetrics } = trpc.queue.metrics.useQuery(
    { queueName, type: "completed", start: 0, end: 60 },
    { enabled: supportsMetrics, refetchInterval: REFETCH_INTERVAL },
  );

  const { data: failedMetrics } = trpc.queue.metrics.useQuery(
    { queueName, type: "failed", start: 0, end: 60 },
    { enabled: supportsMetrics, refetchInterval: REFETCH_INTERVAL },
  );

  if (isLoading) {
    return <Skeleton className="h-10 rounded-lg" />;
  }

  if (!queue) return null;

  const completedData = completedMetrics?.data ?? [];
  const failedData = failedMetrics?.data ?? [];

  return (
    <Link
      to={`../${queue.name}`}
      className="group flex items-center gap-4 rounded-lg px-3 py-2.5 transition-colors hover:bg-gray-100/60 dark:hover:bg-slate-800/50"
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
