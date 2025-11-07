import { ArrowUpIcon, ArrowDownIcon } from "@radix-ui/react-icons";

type MetricsCardProps = {
  label: string;
  value: number | string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  variant?: "completed" | "failed";
};

export const MetricsCard = ({
  label,
  value,
  trend,
  variant = "completed",
}: MetricsCardProps) => {
  const trendColor =
    variant === "completed"
      ? trend?.isPositive
        ? "text-green-600 dark:text-green-400"
        : "text-red-600 dark:text-red-400"
      : trend?.isPositive
        ? "text-red-600 dark:text-red-400"
        : "text-green-600 dark:text-green-400";

  return (
    <div className="group flex flex-col space-y-2 rounded-xl border border-slate-200/80 bg-white/80 px-4 py-3 backdrop-blur-sm transition-all duration-200 hover:border-slate-300 hover:shadow-sm dark:border-slate-700/50 dark:bg-slate-900/50 dark:hover:border-slate-600">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <div className="flex items-baseline space-x-2">
        <p className="font-mono text-2xl font-semibold tabular-nums leading-none text-slate-900 dark:text-slate-50">
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
        {trend && (
          <div className={`flex items-center space-x-0.5 font-mono text-xs font-medium ${trendColor}`}>
            {trend.isPositive ? (
              <ArrowUpIcon width={11} height={11} />
            ) : (
              <ArrowDownIcon width={11} height={11} />
            )}
            <span>{Math.abs(trend.value)}%</span>
          </div>
        )}
      </div>
    </div>
  );
};
