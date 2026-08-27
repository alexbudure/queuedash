import { clsx } from "clsx";

import {
  getTableGridClassName,
  type TableLayoutVariant,
} from "../utils/viewState";
import { Skeleton } from "./Skeleton";

export const JobTableSkeleton = ({
  layoutVariant = "job",
  rows = 30,
  selectable = true,
}: {
  layoutVariant?: TableLayoutVariant;
  rows?: number;
  selectable?: boolean;
}) => {
  const gridClassName = getTableGridClassName(layoutVariant, selectable);

  return (
    <div className="min-w-max">
      {/* Header */}
      <div
        className={`grid ${gridClassName} border-b border-gray-100/60 bg-gray-50/80 px-2 py-1.5 dark:border-slate-800/60 dark:bg-slate-900/80`}
      >
        {selectable ? <div /> : null}
        <div className="px-1.5">
          <Skeleton className="h-3.5 w-8 rounded" />
        </div>
        <div className="px-1.5">
          <Skeleton className="h-3.5 w-14 rounded" />
        </div>
        <div />
      </div>
      {/* Rows */}
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={clsx(
            "grid px-2 py-2.5",
            gridClassName,
            rows !== i + 1
              ? "border-b border-gray-100/60 dark:border-slate-800/60"
              : "",
          )}
        >
          {/* Checkbox */}
          {selectable ? (
            <div className="flex items-center px-1.5">
              <Skeleton className="size-4 rounded" />
            </div>
          ) : null}
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
