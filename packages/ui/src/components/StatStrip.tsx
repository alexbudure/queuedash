import { clsx } from "clsx";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import {
  CARD_BORDER,
  FOCUS_RING,
  SECTION_LABEL,
  TEXT_MUTED,
} from "../utils/styles";
import { Skeleton } from "./Skeleton";

/**
 * One cell of a strip: label, number, one line of context, an optional aside.
 * Two-up until there is room for the full row: at tablet widths four cells
 * squeezed the labels onto two lines and cut the sub-labels short.
 */
// An odd cell out spans the two-up row rather than leaving half of it empty.
export const STAT_CELL =
  "flex min-w-0 items-end justify-between gap-3 border-gray-100/60 px-4 py-3 text-left [&:nth-child(even)]:border-l [&:nth-child(n+3)]:border-t [&:last-child:nth-child(odd)]:col-span-2 xl:[&:not(:first-child)]:border-l xl:[&:nth-child(n+3)]:border-t-0 xl:[&:last-child:nth-child(odd)]:col-span-1 dark:border-slate-800/60";

export const STAT_VALUE =
  "font-mono text-lg font-semibold tabular-nums leading-7";
export const STAT_SUB = "mt-0.5 truncate font-mono text-[11px] tabular-nums";

const COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 xl:grid-cols-3",
  4: "grid-cols-2 xl:grid-cols-4",
  5: "grid-cols-2 xl:grid-cols-5",
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
  collapsibleOnPhones = false,
  phoneSummary,
  children,
}: {
  label: string;
  ariaLabel: string;
  /** A control scoped to the numbers, e.g. a time range, at the strip's right. */
  action?: ReactNode;
  columns: 1 | 2 | 3 | 4 | 5;
  /**
   * Below `sm` the strip starts as just its header and opens on a tap. On a
   * phone four stacked cells were ~215px between the page title and the list
   * the page is for; from `sm` up the strip is always open.
   */
  collapsibleOnPhones?: boolean;
  /** The strip in one line, for its folded header on a phone. */
  phoneSummary?: ReactNode;
  children: ReactNode;
}) => {
  const [isOpenOnPhone, setIsOpenOnPhone] = useState(false);
  const bodyId = useId();
  const isClosedOnPhone = collapsibleOnPhones && !isOpenOnPhone;

  return (
    <section aria-label={ariaLabel} className={clsx("rounded-xl", CARD_BORDER)}>
      <div
        className={clsx(
          "flex h-9 items-center justify-between pr-1.5 pl-4",
          collapsibleOnPhones && "max-sm:h-11 max-sm:gap-2 max-sm:px-0",
        )}
      >
        {collapsibleOnPhones ? (
          <>
            {/* The whole header is the toggle on a phone, and folded it
                carries the strip's one-line reading instead of an empty box. */}
            <button
              type="button"
              aria-expanded={isOpenOnPhone}
              aria-controls={bodyId}
              onClick={() => setIsOpenOnPhone((open) => !open)}
              className={clsx(
                "flex h-full min-w-0 flex-1 items-center justify-between gap-3 rounded-xl pr-3 pl-3.5 sm:hidden",
                FOCUS_RING,
              )}
            >
              <span className={SECTION_LABEL}>{label}</span>
              <span className="flex min-w-0 items-center gap-2">
                {isOpenOnPhone || !phoneSummary ? null : (
                  <span className="min-w-0 truncate font-mono text-xs text-gray-700 tabular-nums dark:text-slate-200">
                    {phoneSummary}
                  </span>
                )}
                <ChevronDown
                  aria-hidden="true"
                  className={clsx(
                    "size-4 shrink-0 transition-transform duration-150",
                    TEXT_MUTED,
                    isOpenOnPhone && "rotate-180",
                  )}
                />
              </span>
            </button>
            <h2 className={clsx("hidden sm:block", SECTION_LABEL)}>{label}</h2>
          </>
        ) : (
          <h2 className={SECTION_LABEL}>{label}</h2>
        )}
        <div
          className={clsx(
            isClosedOnPhone && "hidden sm:block",
            collapsibleOnPhones && "max-sm:pr-1.5",
          )}
        >
          {action}
        </div>
      </div>
      <div
        id={bodyId}
        className={clsx(
          "border-t border-gray-100/60 dark:border-slate-800/60",
          COLUMNS[columns],
          isClosedOnPhone ? "hidden sm:grid" : "grid",
        )}
      >
        {children}
      </div>
    </section>
  );
};
