import { clsx } from "clsx";
import type { ReactNode } from "react";

import { CARD_BORDER, SECTION_LABEL, TEXT_MUTED } from "../utils/styles";
import { Skeleton } from "./Skeleton";

/**
 * One cell of a strip: label, number, one line of context, an optional aside.
 * Two-up until there is room for the full row: at tablet widths four cells
 * squeezed the labels onto two lines and cut the sub-labels short.
 */
export const STAT_CELL =
  "flex min-w-0 items-end justify-between gap-3 border-gray-100/60 px-4 py-3 text-left [&:nth-child(even)]:border-l [&:nth-child(n+3)]:border-t xl:[&:not(:first-child)]:border-l xl:[&:nth-child(n+3)]:border-t-0 dark:border-slate-800/60";

export const STAT_VALUE =
  "font-mono text-lg font-semibold tabular-nums leading-7";
export const STAT_SUB = "mt-0.5 truncate font-mono text-[11px] tabular-nums";

const COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 xl:grid-cols-3",
  4: "grid-cols-2 xl:grid-cols-4",
};

const TONE_CLASS = {
  neutral: "text-gray-900 dark:text-white",
  negative: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
} as const;

export type StatTone = keyof typeof TONE_CLASS;

export const StatCell = ({
  label,
  value,
  trend,
  sub,
  aside,
  tone = "neutral",
  isStale = false,
}: {
  label: string;
  value: string;
  trend?: ReactNode;
  sub: string;
  /** Decoration beside the number, e.g. a sparkline. Never the only copy of a fact. */
  aside?: ReactNode;
  /** Colours the number; `warning` also colours the context line. */
  tone?: StatTone;
  /** Numbers from a previous query, dimmed while the new ones load. */
  isStale?: boolean;
}) => (
  <div
    className={clsx(
      STAT_CELL,
      "transition-opacity duration-150",
      isStale && "opacity-50",
    )}
  >
    <div className="min-w-0">
      <p className={SECTION_LABEL}>{label}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
        <span className={clsx(STAT_VALUE, TONE_CLASS[tone])}>{value}</span>
        {trend}
      </div>
      <p
        className={clsx(
          STAT_SUB,
          tone === "warning" ? TONE_CLASS.warning : TEXT_MUTED,
        )}
      >
        {sub}
      </p>
    </div>
    {aside}
  </div>
);

export const StatCellSkeleton = () => (
  <div className={STAT_CELL}>
    <div>
      <Skeleton className="h-4 w-16 rounded" />
      <Skeleton className="mt-1 h-7 w-20 rounded" />
      <Skeleton className="mt-0.5 h-4 w-12 rounded" />
    </div>
  </div>
);

/**
 * A row of numbers about something - a queue, the whole fleet - in one card,
 * so the page's real content starts right below it.
 */
export const StatStrip = ({
  label,
  ariaLabel,
  action,
  columns,
  children,
}: {
  label: string;
  ariaLabel: string;
  /** A control scoped to the numbers, e.g. a time range, at the strip's right. */
  action?: ReactNode;
  columns: 1 | 2 | 3 | 4;
  children: ReactNode;
}) => (
  <section aria-label={ariaLabel} className={clsx("rounded-xl", CARD_BORDER)}>
    <div className="flex h-9 items-center justify-between pr-1.5 pl-4">
      <h2 className={SECTION_LABEL}>{label}</h2>
      {action}
    </div>
    <div
      className={clsx(
        "grid border-t border-gray-100/60 dark:border-slate-800/60",
        COLUMNS[columns],
      )}
    >
      {children}
    </div>
  </section>
);
