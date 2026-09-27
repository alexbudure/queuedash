import { clsx } from "clsx";
import { AlertTriangle, Inbox, RotateCw } from "lucide-react";
import type { ReactNode } from "react";

import { FOCUS_RING } from "../utils/styles";

type ErrorCardProps = {
  /** Short headline. Falls back to a sensible default per tone. */
  title?: string;
  message: string;
  /** Wire this to the failing query's `refetch`. */
  onRetry?: () => void;
  isRetrying?: boolean;
  /**
   * `error` is an alarm - something broke. `empty` is a neutral absence, e.g.
   * a mistyped URL resolving to no queue, which should not look like an
   * outage.
   */
  tone?: "error" | "empty";
  action?: ReactNode;
  className?: string;
};

export const ErrorCard = ({
  title,
  message,
  onRetry,
  isRetrying,
  tone = "error",
  action,
  className,
}: ErrorCardProps) => {
  const isError = tone === "error";
  const Icon = isError ? AlertTriangle : Inbox;

  return (
    <div
      role={isError ? "alert" : undefined}
      className={clsx(
        "flex items-start gap-3 rounded-xl border px-4 py-5 text-left",
        isError
          ? "border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/40"
          : "border-gray-200 bg-gray-50 dark:border-slate-800 dark:bg-slate-900",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={clsx(
          "mt-0.5 size-4 shrink-0",
          isError
            ? "text-red-600 dark:text-red-400"
            : "text-gray-500 dark:text-slate-400",
        )}
      />

      <div className="min-w-0 flex-1">
        <p
          className={clsx(
            "text-sm font-medium",
            isError
              ? "text-red-900 dark:text-red-200"
              : "text-gray-900 dark:text-white",
          )}
        >
          {title ?? (isError ? "Something went wrong" : "Nothing here")}
        </p>

        <p
          className={clsx(
            "mt-1 text-sm break-words",
            isError
              ? "text-red-800/90 dark:text-red-300/90"
              : "text-gray-600 dark:text-slate-400",
          )}
        >
          {message}
        </p>

        {onRetry || action ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                disabled={isRetrying}
                className={clsx(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  isError
                    ? "border-red-300 bg-white text-red-800 hover:bg-red-100 active:bg-red-200 dark:border-red-800 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-950 dark:active:bg-red-900/60"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 active:bg-gray-100 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800 dark:active:bg-slate-700",
                  FOCUS_RING,
                )}
              >
                <RotateCw
                  aria-hidden="true"
                  className={clsx("size-3", isRetrying && "animate-spin")}
                />
                {isRetrying ? "Retrying\u2026" : "Retry"}
              </button>
            ) : null}
            {action}
          </div>
        ) : null}
      </div>
    </div>
  );
};
