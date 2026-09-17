import { clsx } from "clsx";
import { useEffect, useRef } from "react";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";

import { formatCount } from "../utils/format";
import { STATUS_ICONS, STATUS_TINT } from "../utils/status";
import { FOCUS_RING_DATA, TEXT_FAINT, TEXT_MUTED } from "../utils/styles";
import type { RouterOutput, Status } from "../utils/trpc";
import { Skeleton } from "./Skeleton";

const statusPressedMap: Record<Status, string> = {
  completed: "data-[pressed]:bg-green-100 dark:data-[pressed]:bg-green-950/60",
  failed: "data-[pressed]:bg-red-100 dark:data-[pressed]:bg-red-950/60",
  active: "data-[pressed]:bg-blue-100 dark:data-[pressed]:bg-blue-950/60",
  prioritized:
    "data-[pressed]:bg-purple-100 dark:data-[pressed]:bg-purple-950/60",
  waiting: "data-[pressed]:bg-amber-100 dark:data-[pressed]:bg-amber-950/60",
  "waiting-children":
    "data-[pressed]:bg-orange-100 dark:data-[pressed]:bg-orange-950/60",
  delayed: "data-[pressed]:bg-cyan-100 dark:data-[pressed]:bg-cyan-950/60",
  paused: "data-[pressed]:bg-gray-200 dark:data-[pressed]:bg-slate-700",
};

const PILL =
  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors duration-150";

const INACTIVE =
  "border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white";

type QueueStatusFilterProps = {
  status: Status;
  queue?: RouterOutput["queue"]["byName"];
  onStatusChange: (status: Status) => void;
};

/**
 * Status is a filter on the job list, so it is drawn as one: a row of pills
 * that wraps, rather than eight fixed-width cards that scroll. The counts
 * stay - they are what makes the row worth scanning.
 */
export const QueueStatusFilter = ({
  status,
  queue,
  onStatusChange,
}: QueueStatusFilterProps) => {
  const selectedRef = useRef<HTMLButtonElement>(null);

  // On a phone the row scrolls, and a status picked from a link or a
  // bookmark can start out of view. Only the row moves - scrollIntoView
  // would also drag the page down to the pills on load.
  useEffect(() => {
    const pill = selectedRef.current;
    const row = pill?.parentElement;
    if (!pill || !row || row.scrollWidth <= row.clientWidth) return;
    const rowRect = row.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    if (pillRect.left < rowRect.left) {
      row.scrollLeft += pillRect.left - rowRect.left - 16;
    } else if (pillRect.right > rowRect.right) {
      row.scrollLeft += pillRect.right - rowRect.right + 16;
    }
    // `queue` is a dependency because the pills only exist once it has loaded.
  }, [queue, status]);

  const tabs: { name: string; status: Status }[] = [
    { name: "Completed", status: "completed" },
    { name: "Failed", status: "failed" },
    { name: "Active", status: "active" },
    ...(queue?.supports.priorities &&
    queue.supports.statuses.includes("prioritized")
      ? [{ name: "Prioritized", status: "prioritized" as const }]
      : []),
    { name: "Waiting", status: "waiting" },
    ...(queue?.supports.flows
      ? [{ name: "Waiting children", status: "waiting-children" as const }]
      : []),
    { name: "Delayed", status: "delayed" },
    ...(queue?.supports.statuses.includes("paused")
      ? [{ name: "Paused", status: "paused" as const }]
      : []),
  ];

  if (!queue) {
    return (
      <div aria-hidden="true" className="flex flex-wrap gap-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-28 rounded-full" />
        ))}
      </div>
    );
  }

  return (
    <ToggleButtonGroup
      aria-label="Filter jobs by status"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[status]}
      onSelectionChange={(keys) => {
        const [next] = Array.from(keys);
        if (next !== undefined && next !== status) {
          onStatusChange(next as Status);
        }
      }}
      // Bleeds to the card edge on phones so a cut-off pill says "more".
      className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const isActive = tab.status === status;
        const Icon = STATUS_ICONS[tab.status];
        const count = queue.counts[tab.status] ?? 0;
        return (
          <ToggleButton
            ref={isActive ? selectedRef : undefined}
            id={tab.status}
            key={tab.status}
            aria-label={`${tab.name}, ${formatCount(count)}`}
            className={clsx(
              PILL,
              FOCUS_RING_DATA,
              isActive ? STATUS_TINT[tab.status] : INACTIVE,
              statusPressedMap[tab.status],
            )}
          >
            <Icon
              aria-hidden="true"
              className={clsx("size-3.5 shrink-0", !isActive && TEXT_FAINT)}
            />
            <span>{tab.name}</span>
            <span
              className={clsx(
                "font-mono tabular-nums",
                !isActive && (count === 0 ? TEXT_FAINT : TEXT_MUTED),
              )}
            >
              {formatCount(count)}
            </span>
          </ToggleButton>
        );
      })}
    </ToggleButtonGroup>
  );
};
