import { clsx } from "clsx";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { formatCountLabel, formatDurationFromSeconds } from "../utils/format";
import { FOCUS_RING, TEXT_MUTED } from "../utils/styles";
import type { RouterOutput } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { useQueuedash } from "./QueuedashProvider";
import { SidePanelDialog } from "./SidePanelDialog";

type Worker = NonNullable<RouterOutput["queue"]["workers"]>[number];

type WorkersState = {
  /** `null` when this Redis will not let workers be inspected at all. */
  workers: Worker[] | null | undefined;
  isLoading: boolean;
  isError: boolean;
  /**
   * Jobs are waiting and none is running, so "no workers" means nothing will
   * move. See `isWaitingOnWorkers`.
   */
  hasPendingWork: boolean;
};

/**
 * Jobs are ready to run and none of them is running. An active job proves
 * something is processing even when no worker shows up in the list, so it
 * rules the "Not processing" warning out.
 */
export const isWaitingOnWorkers = (counts: {
  waiting: number;
  prioritized: number;
  active: number;
}) => counts.waiting + counts.prioritized > 0 && counts.active === 0;

/** The one-line reading of the worker list, shared by the cell and the panel. */
export const workersSummary = ({
  workers,
  isLoading,
  isError,
  hasPendingWork,
}: WorkersState): {
  value: string;
  sub: string;
  tone: "normal" | "warning";
} => {
  if (isLoading) return { value: "—", sub: "Checking…", tone: "normal" };
  // Unknown is not zero: a Redis that will not list its clients says nothing
  // about whether workers are there, so it must not read as "Not processing".
  if (isError || workers === null) {
    return { value: "—", sub: "Unavailable", tone: "normal" };
  }
  const list = workers ?? [];
  if (list.length === 0) {
    return hasPendingWork
      ? { value: "0", sub: "Not processing", tone: "warning" }
      : { value: "0", sub: "None reported", tone: "normal" };
  }
  // Idle time is per adapter and optional; the smallest one is how long ago
  // any worker last touched Redis.
  const idle = list
    .map((worker) => worker.idleSeconds)
    .filter((seconds): seconds is number => typeof seconds === "number");
  return {
    value: String(list.length),
    sub: idle.length
      ? `last seen ${formatDurationFromSeconds(Math.min(...idle))} ago`
      : "connected",
    tone: "normal",
  };
};

export const WorkersPanel = ({
  open,
  onOpenChange,
  queueName,
  workers,
  isLoading,
  isError,
  hasPendingWork,
}: WorkersState & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queueName: string;
}) => (
  <SidePanelDialog
    title="Workers"
    subtitle={queueName}
    open={open}
    onOpenChange={onOpenChange}
    panelClassName="!max-w-[440px]"
  >
    <div className="px-6 py-5">
      {isLoading ? (
        <div className={clsx("flex items-center gap-2 text-xs", TEXT_MUTED)}>
          <Loader2 className="size-3.5 animate-spin" />
          Checking workers…
        </div>
      ) : isError ? (
        <p className="text-xs text-red-600 dark:text-red-400">
          Could not check workers.
        </p>
      ) : workers === null ? (
        <p className={clsx("text-xs", TEXT_MUTED)}>
          Worker inspection is unavailable from this Redis server.
        </p>
      ) : workers?.length ? (
        <ul className="space-y-2">
          {workers.map((worker) => {
            const name = worker.name || `Worker ${worker.id}`;
            return (
              <li
                key={worker.id}
                className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-slate-800"
              >
                <div
                  title={name}
                  className="truncate font-mono text-xs font-medium text-gray-800 dark:text-slate-200"
                >
                  {name}
                </div>
                <div
                  className={clsx("mt-1 flex gap-3 text-[10px]", TEXT_MUTED)}
                >
                  <span>
                    age {formatDurationFromSeconds(worker.ageSeconds)}
                  </span>
                  <span>
                    idle {formatDurationFromSeconds(worker.idleSeconds)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : hasPendingWork ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          No workers connected — jobs will not be processed.
        </p>
      ) : (
        <p className={clsx("text-xs", TEXT_MUTED)}>
          No active workers reported.
        </p>
      )}
    </div>
  </SidePanelDialog>
);

/**
 * The worker count as one more fact in a queue's subtitle, for queues with no
 * metrics to build a strip from. It still opens the list, and it still turns
 * amber when jobs are waiting and nobody is there to run them.
 */
export const WorkersInline = ({
  queueName,
  hasPendingWork,
}: {
  queueName: string;
  hasPendingWork: boolean;
}) => {
  const { preferences } = useQueuedash();
  const [open, setOpen] = useState(false);
  const workersReq = trpc.queue.workers.useQuery(
    { queueName },
    { refetchInterval: preferences.refreshIntervalMs },
  );
  const isUnavailable = workersReq.isError || workersReq.data === null;
  const count = workersReq.data?.length ?? 0;
  const isWarning =
    !workersReq.isLoading && !isUnavailable && count === 0 && hasPendingWork;
  const label = workersReq.isLoading
    ? "checking workers"
    : isUnavailable
      ? "workers unavailable"
      : isWarning
        ? "0 workers, not processing"
        : formatCountLabel(count, "worker");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={clsx(
          "rounded underline decoration-dotted underline-offset-2 transition-colors duration-150 hover:text-gray-900 dark:hover:text-white",
          isWarning && "text-amber-600 dark:text-amber-400",
          FOCUS_RING,
        )}
      >
        {label}
      </button>
      {open ? (
        <WorkersPanel
          open={open}
          onOpenChange={setOpen}
          queueName={queueName}
          workers={workersReq.data}
          isLoading={workersReq.isLoading}
          isError={workersReq.isError}
          hasPendingWork={hasPendingWork}
        />
      ) : null}
    </>
  );
};
