import { clsx } from "clsx";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";

import { formatCount } from "../utils/format";
import { FOCUS_RING_DATA, TEXT_MUTED } from "../utils/styles";

export type QueueView = "jobs" | "errors" | "schedulers";

const TAB =
  "relative -mb-px flex h-9 items-center gap-1.5 border-b-2 px-0.5 text-sm font-medium whitespace-nowrap transition-colors duration-150";

/**
 * Schedulers are not a ninth job status - they are the things that *make*
 * jobs - and errors are failed jobs read another way. Each gets its own view,
 * which keeps the status filter honest.
 */
export const QueueViewTabs = ({
  view,
  errorCount,
  schedulerCount,
  showSchedulers,
  onViewChange,
}: {
  view: QueueView;
  errorCount: number | undefined;
  schedulerCount: number | undefined;
  showSchedulers: boolean;
  onViewChange: (view: QueueView) => void;
}) => {
  const tabs: Array<{
    id: QueueView;
    label: string;
    count: number | undefined;
    isAlert?: boolean;
  }> = [
    { id: "jobs", label: "Jobs", count: undefined },
    { id: "errors", label: "Errors", count: errorCount, isAlert: true },
    ...(showSchedulers
      ? [
          {
            id: "schedulers" as const,
            label: "Schedulers",
            count: schedulerCount,
          },
        ]
      : []),
  ];

  return (
    <ToggleButtonGroup
      aria-label="Queue view"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[view]}
      onSelectionChange={(keys) => {
        const [next] = Array.from(keys);
        if (next !== undefined && next !== view) {
          onViewChange(next as QueueView);
        }
      }}
      className="flex gap-5 border-b border-gray-100/60 dark:border-slate-800/60"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === view;
        return (
          <ToggleButton
            key={tab.id}
            id={tab.id}
            className={clsx(
              TAB,
              FOCUS_RING_DATA,
              isActive
                ? "border-gray-900 text-gray-900 dark:border-white dark:text-white"
                : "border-transparent text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white",
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span
                className={clsx(
                  "rounded-full px-1.5 py-px font-mono text-[10px] tabular-nums",
                  tab.isAlert && tab.count > 0 && isActive
                    ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                    : clsx(
                        "bg-gray-100 dark:bg-slate-800",
                        isActive
                          ? "text-gray-700 dark:text-slate-200"
                          : TEXT_MUTED,
                      ),
                )}
              >
                {formatCount(tab.count)}
              </span>
            ) : null}
          </ToggleButton>
        );
      })}
    </ToggleButtonGroup>
  );
};
