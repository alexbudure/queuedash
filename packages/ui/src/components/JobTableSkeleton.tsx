import { JOBS_PER_PAGE } from "../utils/config";
import { clsx } from "clsx";
import { Skeleton } from "./Skeleton";

export const JobTableSkeleton = () => {
  return (
    <div className="min-w-max">
      {/* Header */}
      <div className="grid grid-cols-[36px_minmax(200px,35%)_minmax(auto,1fr)_100px] border-b border-gray-100/60 bg-gray-50/80 px-2 py-1.5 dark:border-slate-800/60 dark:bg-slate-900/80">
        <div />
        <div className="px-1.5">
          <Skeleton className="h-3.5 w-8 rounded" />
        </div>
        <div className="px-1.5">
          <Skeleton className="h-3.5 w-14 rounded" />
        </div>
        <div />
      </div>
      {/* Rows */}
      {[...new Array(JOBS_PER_PAGE)].map((_, i) => (
        <div
          key={i}
          className={clsx(
            "grid grid-cols-[36px_minmax(200px,35%)_minmax(auto,1fr)_100px] px-2 py-2.5",
            JOBS_PER_PAGE !== i + 1
              ? "border-b border-gray-100/60 dark:border-slate-800/60"
              : "",
          )}
        >
          {/* Checkbox */}
          <div className="flex items-center px-1.5">
            <Skeleton className="size-4 rounded" />
          </div>
          {/* Job name */}
          <div className="flex items-center gap-2 px-1.5">
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-4 w-12 rounded-full" />
          </div>
          {/* Lifecycle */}
          <div className="flex items-center gap-6 px-1.5">
            <div className="flex items-center gap-1.5">
              <Skeleton className="size-3 rounded-full" />
              <Skeleton className="h-3.5 w-20 rounded" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-3.5 w-12 rounded" />
          </div>
          {/* Metadata */}
          <div className="flex items-center px-1.5">
            <Skeleton className="size-4 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
};
