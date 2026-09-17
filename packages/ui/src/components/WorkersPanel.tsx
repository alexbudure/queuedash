import { clsx } from "clsx";
import { Loader2 } from "lucide-react";

import { formatDurationFromSeconds } from "../utils/format";
import { TEXT_MUTED } from "../utils/styles";
import type { RouterOutput } from "../utils/trpc";
import { SidePanelDialog } from "./SidePanelDialog";

type Worker = RouterOutput["queue"]["workers"][number];

type WorkersState = {
  workers: Worker[] | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Jobs are waiting or active, so "no workers" means nothing will move. */
  hasPendingWork: boolean;
};

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
  if (isError) return { value: "—", sub: "Unavailable", tone: "normal" };
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
