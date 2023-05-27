import { JOBS_PER_PAGE } from "../utils/config";
import { clsx } from "clsx";
import { Skeleton } from "./Skeleton";

export const JobTableSkeleton = () => {
  return (
    <div>
      <div className="rounded-t-md border-b border-slate-200 bg-slate-50 p-2 text-left text-sm font-semibold dark:border-slate-700 dark:bg-slate-800">
        <span className="opacity-0">Placeholder</span>
      </div>
      {[...new Array(JOBS_PER_PAGE)].map((_, i) => {
        return (
          <div
            key={i}
            className={clsx(
              "p-2",
              JOBS_PER_PAGE !== i + 1
                ? "border-b border-slate-200 dark:border-slate-700"
                : ""
            )}
          >
            <Skeleton className="h-6 w-full" />
          </div>
        );
      })}
    </div>
  );
};
