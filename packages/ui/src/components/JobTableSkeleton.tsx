import { clsx } from "clsx";
import type { ReactNode } from "react";

import {
  getTableCellPaddingClassName,
  getTableGridClassName,
  getTableHeaderPaddingClassName,
  getTableMinWidthClassName,
  getTableRowPaddingClassName,
  type TableLayoutVariant,
} from "../utils/viewState";
import { useQueuedash } from "./QueuedashProvider";
import { Skeleton } from "./Skeleton";

/** A 20px bar inside 4px of padding - the same 28px box a real cell's
 *  `text-sm` line occupies, so the table never resizes when data lands. */
const CellLine = ({ className }: { className: string }) => (
  <div className="py-1">
    <Skeleton className={clsx("h-5 rounded", className)} />
  </div>
);

type LayoutShape = {
  /** One entry per non-selection column; `null` is a column with no header, so
   *  no label pops in from nothing when the data arrives. */
  headers: (string | null)[];
  cells: (() => ReactNode)[];
};

const LAYOUTS: Record<TableLayoutVariant, LayoutShape> = {
  job: {
    headers: ["w-8", "w-16", null],
    cells: [
      () => (
        <div className="flex items-center gap-2 py-1">
          <Skeleton className="h-5 w-24 rounded" />
          <Skeleton className="h-4 w-12 rounded-full" />
        </div>
      ),
      () => (
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-1.5">
            <Skeleton className="size-3 rounded-full" />
            <Skeleton className="h-3.5 w-20 rounded" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-3.5 w-12 rounded" />
        </div>
      ),
      () => <Skeleton className="size-5 rounded-full" />,
    ],
  },
  // Schedulers are three single-line columns, not the job lifecycle cluster.
  scheduler: {
    headers: ["w-20", "w-14", "w-16"],
    cells: [
      () => <CellLine className="w-32" />,
      () => <CellLine className="w-40" />,
      () => <CellLine className="w-28" />,
    ],
  },
};

export const JobTableSkeleton = ({
  layoutVariant = "job",
  rows = 30,
  selectable = true,
}: {
  layoutVariant?: TableLayoutVariant;
  rows?: number;
  selectable?: boolean;
}) => {
  const { preferences } = useQueuedash();
  const gridClassName = getTableGridClassName(layoutVariant, selectable);
  const cellClassName = clsx(
    "flex h-full items-center px-1.5",
    getTableCellPaddingClassName(preferences.density),
  );
  const { cells, headers } = LAYOUTS[layoutVariant];

  return (
    <div className={getTableMinWidthClassName(layoutVariant)}>
      {/* Header */}
      <div
        className={clsx(
          "grid border-b border-gray-100/60 bg-gray-50/80 px-2 dark:border-slate-800/60 dark:bg-slate-900/80",
          gridClassName,
          getTableHeaderPaddingClassName(preferences.density),
        )}
      >
        {selectable ? <div /> : null}
        {headers.map((width, index) => (
          <div className="flex h-full items-center px-1.5" key={index}>
            {width ? <Skeleton className={clsx("h-4 rounded", width)} /> : null}
          </div>
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div
          key={rowIndex}
          className={clsx(
            "grid px-2",
            gridClassName,
            getTableRowPaddingClassName(preferences.density),
            rows !== rowIndex + 1 &&
              "border-b border-gray-100/60 dark:border-slate-800/60",
          )}
        >
          {selectable ? (
            <div className={cellClassName}>
              <Skeleton className="size-4 rounded" />
            </div>
          ) : null}
          {cells.map((renderCell, cellIndex) => (
            <div className={cellClassName} key={cellIndex}>
              {renderCell()}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
