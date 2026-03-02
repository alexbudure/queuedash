import { Tab, TabList, Tabs, type Key } from "react-aria-components";
import { clsx } from "clsx";
import type { RouterOutput, Status } from "../utils/trpc";
import {
  Calendar,
  CheckCircle,
  CircleX,
  Zap,
  CircleArrowUp,
  Clock,
  GitFork,
  Timer,
  CirclePause,
  type LucideIcon,
} from "lucide-react";
import { Skeleton } from "./Skeleton";

const { format: numberFormat } = new Intl.NumberFormat("en-US");

type StatusTab = {
  name: string;
  status: Status;
};

const statusIconMap: Record<Status, LucideIcon> = {
  completed: CheckCircle,
  failed: CircleX,
  active: Zap,
  prioritized: CircleArrowUp,
  waiting: Clock,
  "waiting-children": GitFork,
  delayed: Timer,
  paused: CirclePause,
};

const statusIconColorMap: Record<Status, string> = {
  completed: "text-emerald-600 dark:text-emerald-400",
  failed: "text-red-500 dark:text-red-400",
  active: "text-blue-500 dark:text-blue-400",
  prioritized: "text-purple-500 dark:text-purple-400",
  waiting: "text-amber-500 dark:text-amber-400",
  "waiting-children": "text-orange-500 dark:text-orange-400",
  delayed: "text-cyan-500 dark:text-cyan-400",
  paused: "text-gray-500 dark:text-gray-400",
};

const statusActiveBgMap: Record<Status, string> = {
  completed: "bg-emerald-50 dark:bg-emerald-950/30",
  failed: "bg-red-50 dark:bg-red-950/30",
  active: "bg-blue-50 dark:bg-blue-950/30",
  prioritized: "bg-purple-50 dark:bg-purple-950/30",
  waiting: "bg-amber-50 dark:bg-amber-950/30",
  "waiting-children": "bg-orange-50 dark:bg-orange-950/30",
  delayed: "bg-cyan-50 dark:bg-cyan-950/30",
  paused: "bg-gray-50 dark:bg-slate-800",
};

const statusHoverBgMap: Record<Status, string> = {
  completed: "hover:bg-emerald-50/50 dark:hover:bg-emerald-950/15",
  failed: "hover:bg-red-50/50 dark:hover:bg-red-950/15",
  active: "hover:bg-blue-50/50 dark:hover:bg-blue-950/15",
  prioritized: "hover:bg-purple-50/50 dark:hover:bg-purple-950/15",
  waiting: "hover:bg-amber-50/50 dark:hover:bg-amber-950/15",
  "waiting-children": "hover:bg-orange-50/50 dark:hover:bg-orange-950/15",
  delayed: "hover:bg-cyan-50/50 dark:hover:bg-cyan-950/15",
  paused: "hover:bg-gray-50/50 dark:hover:bg-slate-800/30",
};

const statusActiveTextMap: Record<Status, string> = {
  completed: "text-emerald-700 dark:text-emerald-400",
  failed: "text-red-600 dark:text-red-400",
  active: "text-blue-700 dark:text-blue-400",
  prioritized: "text-purple-700 dark:text-purple-400",
  waiting: "text-amber-700 dark:text-amber-400",
  "waiting-children": "text-orange-700 dark:text-orange-400",
  delayed: "text-cyan-700 dark:text-cyan-400",
  paused: "text-gray-700 dark:text-gray-300",
};

const statusAccentMap: Record<Status, string> = {
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  active: "bg-blue-500",
  prioritized: "bg-purple-500",
  waiting: "bg-amber-500",
  "waiting-children": "bg-orange-500",
  delayed: "bg-cyan-500",
  paused: "bg-gray-400",
};

type QueueStatusTabsProps = {
  status: Status;
  queue?: RouterOutput["queue"]["byName"];
  isSchedulersView?: boolean;
  schedulerCount?: number;
  onTabChange: (key: Key) => void;
};

export const QueueStatusTabs = ({
  status,
  queue,
  isSchedulersView = false,
  schedulerCount,
  onTabChange,
}: QueueStatusTabsProps) => {
  const selectedKey = isSchedulersView ? "schedulers" : status;
  const tabs: StatusTab[] = [
    {
      name: "Completed",
      status: "completed",
    },
    {
      name: "Failed",
      status: "failed",
    },
    {
      name: "Active",
      status: "active",
    },
    ...(queue?.supports.priorities
      ? [{ name: "Prioritized", status: "prioritized" as const }]
      : []),
    {
      name: "Waiting",
      status: "waiting",
    },
    ...(queue?.supports.flows
      ? [{ name: "Waiting Children", status: "waiting-children" as const }]
      : []),
    {
      name: "Delayed",
      status: "delayed",
    },
    ...(queue?.supports.pause
      ? [{ name: "Paused", status: "paused" as const }]
      : []),
  ];

  return (
    <Tabs
      selectedKey={selectedKey}
      onSelectionChange={onTabChange}
      orientation="horizontal"
    >
      <TabList
        aria-label="Queue status"
        className="flex divide-x divide-gray-100/60 overflow-x-auto rounded-xl border border-gray-100/60 dark:divide-slate-800/60 dark:border-slate-800/60"
      >
        {queue ? (
          <>
            {tabs.map((tab) => {
              const isActive = tab.status === selectedKey;
              const Icon = statusIconMap[tab.status];
              const count = queue.counts[tab.status] ?? 0;
              return (
                <Tab
                  id={tab.status}
                  key={tab.status}
                  className={clsx(
                    "relative flex min-w-[120px] flex-1 cursor-pointer flex-col px-3 py-2.5 outline-none transition-colors",
                    isActive
                      ? statusActiveBgMap[tab.status]
                      : statusHoverBgMap[tab.status],
                  )}
                >
                  {isActive && (
                    <div
                      className={clsx(
                        "absolute inset-x-0 bottom-0 h-0.5",
                        statusAccentMap[tab.status],
                      )}
                    />
                  )}
                  <div className="flex items-center justify-between gap-1.5">
                    <span
                      className={clsx("truncate text-xs", {
                        ["font-semibold " + statusActiveTextMap[tab.status]]:
                          isActive,
                        "font-medium text-gray-500 dark:text-slate-400":
                          !isActive,
                      })}
                    >
                      {tab.name}
                    </span>
                    <Icon
                      className={clsx(
                        "size-3.5 shrink-0",
                        isActive
                          ? statusIconColorMap[tab.status]
                          : "text-gray-400 dark:text-slate-500",
                      )}
                    />
                  </div>
                  <span
                    className={clsx("mt-0.5 font-mono text-xl font-bold", {
                      [statusActiveTextMap[tab.status]]: isActive,
                      "text-gray-900 dark:text-white": !isActive,
                    })}
                  >
                    {numberFormat(count)}
                  </span>
                </Tab>
              );
            })}
            {queue.supports.schedulers ? (
              <Tab
                id="schedulers"
                className={clsx(
                  "relative flex min-w-[120px] flex-1 cursor-pointer flex-col px-3 py-2.5 outline-none transition-colors",
                  isSchedulersView
                    ? "bg-violet-50 dark:bg-violet-950/30"
                    : "hover:bg-violet-50/50 dark:hover:bg-violet-950/15",
                )}
              >
                {isSchedulersView && (
                  <div className="absolute inset-x-0 bottom-0 h-0.5 bg-violet-500" />
                )}
                <div className="flex items-center justify-between gap-1.5">
                  <span
                    className={clsx("truncate text-xs", {
                      "font-semibold text-violet-700 dark:text-violet-400":
                        isSchedulersView,
                      "font-medium text-gray-500 dark:text-slate-400":
                        !isSchedulersView,
                    })}
                  >
                    Schedulers
                  </span>
                  <Calendar
                    className={clsx("size-3.5 shrink-0", {
                      "text-violet-500 dark:text-violet-400": isSchedulersView,
                      "text-gray-400 dark:text-slate-500": !isSchedulersView,
                    })}
                  />
                </div>
                <span
                  className={clsx("mt-0.5 text-xl font-bold", {
                    "text-violet-700 dark:text-violet-400": isSchedulersView,
                    "text-gray-900 dark:text-white": !isSchedulersView,
                  })}
                >
                  {schedulerCount !== undefined
                    ? numberFormat(schedulerCount)
                    : "\u2014"}
                </span>
              </Tab>
            ) : null}
          </>
        ) : (
          Array.from({ length: 8 }).map((_, i) => (
            <Tab
              key={i}
              className="flex min-w-[120px] flex-1 flex-col px-3 py-2.5"
            >
              <div className="flex items-center justify-between">
                <Skeleton className="h-3.5 w-14 rounded" />
                <Skeleton className="size-3.5 rounded-full" />
              </div>
              <Skeleton className="mt-1.5 h-7 w-12 rounded" />
            </Tab>
          ))
        )}
      </TabList>
    </Tabs>
  );
};
