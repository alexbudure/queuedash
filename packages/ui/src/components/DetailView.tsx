import { clsx } from "clsx";
import { Children, type ReactNode } from "react";

import { SECTION_LABEL, TEXT_MUTED } from "../utils/styles";

/**
 * The building blocks of a detail panel. Sections stack with hairlines between
 * them and one rhythm of padding, so "Properties", "Job data" and "Logs" read
 * as chapters of one document rather than boxes that happen to be near each
 * other.
 */
export const DetailBody = ({ children }: { children: ReactNode }) => (
  <div className="divide-y divide-gray-100/60 dark:divide-slate-800/60">
    {children}
  </div>
);

export const DetailSection = ({
  title,
  action,
  children,
}: {
  title?: string;
  /** A control scoped to this section, at the label's right. */
  action?: ReactNode;
  children?: ReactNode;
}) => {
  // A collapsed section is just its header; the gap below it would otherwise
  // hang under nothing.
  const hasContent = Children.toArray(children).length > 0;

  return (
    <section className="px-6 py-5">
      {title || action ? (
        <header
          className={clsx(
            "flex h-5 items-center justify-between gap-3",
            hasContent && "mb-3",
          )}
        >
          {title ? <h3 className={SECTION_LABEL}>{title}</h3> : <span />}
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
};

/**
 * Label on the left, value beside it, one row per fact. A two-column grid of
 * label-over-value pairs made "Priority 2" and "Attempt 1" float around each
 * other; a list keeps every label in one column and every value in another.
 */
export const PropertyList = ({ children }: { children: ReactNode }) => (
  <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
    {children}
  </dl>
);

export const Property = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  /** For identifiers, numbers and code; names and prose stay in the UI face. */
  mono?: boolean;
}) => (
  <>
    <dt className={clsx("truncate pt-px text-xs leading-5", TEXT_MUTED)}>
      {label}
    </dt>
    <dd
      className={clsx(
        "min-w-0 leading-5 break-words text-gray-900 dark:text-white",
        mono && "font-mono text-[13px]",
      )}
    >
      {value}
    </dd>
  </>
);

/** The small text button that reveals more under a section label. */
export const DisclosureButton = ({
  isOpen,
  controls,
  onToggle,
  children,
}: {
  isOpen: boolean;
  controls: string;
  onToggle: () => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    aria-expanded={isOpen}
    aria-controls={controls}
    onClick={onToggle}
    className={clsx(
      "rounded text-xs font-medium transition-colors duration-150 hover:text-gray-900 active:text-gray-600 dark:hover:text-white dark:active:text-slate-300",
      TEXT_MUTED,
      "outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-brand-600 dark:focus-visible:ring-offset-slate-900",
    )}
  >
    {children}
  </button>
);

/** Lines of code-like text (logs, a stack trace) in the recessed pane. */
export const LinesPane = ({
  lines,
  tone = "neutral",
}: {
  lines: string[];
  tone?: "neutral" | "error";
}) => (
  <div
    className={clsx(
      "qd-scroll max-h-80 overflow-auto rounded-lg p-3",
      tone === "error"
        ? "border border-red-200/60 bg-red-100/40 dark:border-red-900/40 dark:bg-red-950/30"
        : "border border-gray-100/60 bg-gray-50/50 dark:border-slate-800/60 dark:bg-slate-900/50",
    )}
  >
    <div className="space-y-0.5">
      {lines.map((line, index) => (
        <div
          key={index}
          className={clsx(
            "font-mono text-xs break-all whitespace-pre-wrap",
            tone === "error"
              ? "text-red-700/90 dark:text-red-400/80"
              : TEXT_MUTED,
          )}
        >
          {line}
        </div>
      ))}
    </div>
  </div>
);
