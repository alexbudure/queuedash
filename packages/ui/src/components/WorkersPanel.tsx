import { clsx } from "clsx";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { formatCountLabel, formatDurationFromSeconds } from "../utils/format";
import { FOCUS_RING, SECTION_LABEL, TEXT_MUTED } from "../utils/styles";
import type { Queue, RouterOutput } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { useQueuedash } from "./QueuedashProvider";
import { hasQueueLimits, QueueLimitsSection } from "./QueueLimits";
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

/** The one-line reading of the worker list, for the Health strip's cell. */
export const workersSummary = ({
  workers,
  isLoading,
  isError,
  hasPendingWork,
  activeCount,
}: WorkersState & {
  /** The queue's active jobs: what its workers are doing right now. */
  activeCount: number;
}): {
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
  // Redis lists who is connected, not what they are doing. The idle time it
  // keeps is for the connection a worker blocks on while it waits for jobs,
  // so it grows the whole time the worker is busy: read as "last seen", a
  // busy worker looked gone. The queue's active count is the honest signal.
  return {
    value: String(list.length),
    sub: activeCount > 0 ? formatCountLabel(activeCount, "active job") : "idle",
    tone: "normal",
  };
};

/** How long a worker's connection has been open: "connected 15m 8s". */
const formatConnected = (ageSeconds: number | undefined) => {
  if (ageSeconds === undefined) return "connected";
  if (ageSeconds < 1) return "just connected";
  return `connected ${formatDurationFromSeconds(ageSeconds)}`;
};

export const WorkersPanel = ({
  open,
  onOpenChange,
  queueName,
  queue,
  workers,
  isLoading,
  isError,
  hasPendingWork,
}: WorkersState & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queueName: string;
  /** For the limits the workers follow, where the library keeps any. */
  queue?: Queue;
}) => {
  const showLimits = queue !== undefined && hasQueueLimits(queue);
  return (
    <SidePanelDialog
      title="Workers"
      subtitle={queueName}
      open={open}
      onOpenChange={onOpenChange}
      panelClassName="!max-w-[440px]"
    >
      <div className="space-y-6 px-6 py-5">
        {showLimits ? (
          <QueueLimitsSection queue={queue} queueName={queueName} />
        ) : null}
        <section aria-label="Connected workers">
          {showLimits ? (
            <h3 className={`${SECTION_LABEL} mb-3`}>Connected</h3>
          ) : null}
          {isLoading ? (
            <div
              className={clsx("flex items-center gap-2 text-xs", TEXT_MUTED)}
            >
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
                    <div className={clsx("mt-1 text-[10px]", TEXT_MUTED)}>
                      {formatConnected(worker.ageSeconds)}
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
        </section>
      </div>
    </SidePanelDialog>
  );
};

/**
 * The worker count as one more fact in a queue's subtitle, for queues with no
 * metrics to build a strip from. It still opens the list, and it still turns
 * amber when jobs are waiting and nobody is there to run them.
 */
export const WorkersInline = ({
  queue,
  queueName,
  hasPendingWork,
}: {
  queue?: Queue;
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
          queue={queue}
          workers={workersReq.data}
          isLoading={workersReq.isLoading}
          isError={workersReq.isError}
          hasPendingWork={hasPendingWork}
        />
      ) : null}
    </>
  );
};
