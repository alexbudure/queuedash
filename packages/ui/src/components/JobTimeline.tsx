import { clsx } from "clsx";
import { Clock, PlusCircle, Rocket, Timer } from "lucide-react";

import { formatMoment } from "../utils/dateRange";
import { formatDuration } from "../utils/format";
import { isFailedJob, isRunningJob, STATUS_ICONS } from "../utils/status";
import { TEXT_MUTED } from "../utils/styles";
import type { Job, Status } from "../utils/trpc";
import { formatAbsoluteTimestamp, Timestamp } from "./Timestamp";

type JobTimelineProps = {
  job: Job;
  /** The job's current status, when known. */
  status?: Status | null;
  /** Offered beside a delayed job's due time, where it can be moved. */
  onReschedule?: () => void;
};

/** When a delayed job is due: where the library scheduled it, or, where that
 *  isn't known, when it was added plus its delay. */
export const getJobRunAt = (job: Job): number | null => {
  if (job.runAt) return new Date(job.runAt).getTime();
  const delay = Number((job.opts as { delay?: unknown } | null)?.delay);
  return job.createdAt && Number.isFinite(delay) && delay > 0
    ? new Date(job.createdAt).getTime() + delay
    : null;
};

/**
 * A delayed job has not started a life to draw yet: it was added, and it runs
 * at a set time. That time is the thing to know, and to move.
 */
const DelayedTimeline = ({
  job,
  onReschedule,
}: {
  job: Job;
  onReschedule?: () => void;
}) => {
  const addedAt = job.createdAt ? new Date(job.createdAt) : null;
  const runAt = getJobRunAt(job);
  const now = Date.now();

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-slate-800">
          <PlusCircle className="size-3 text-gray-500 dark:text-slate-400" />
        </div>
        <div className="flex min-w-0 flex-col text-xs">
          <span className="font-medium text-gray-500 dark:text-slate-400">
            Added
          </span>
          {addedAt ? (
            <span className={clsx("tabular-nums", TEXT_MUTED)}>
              <Timestamp value={addedAt} variant="time" />
            </span>
          ) : null}
        </div>
      </div>

      <div className="h-px min-w-[20px] flex-1 bg-gray-100 dark:bg-slate-800" />

      <div className="flex min-w-0 items-center gap-2">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-cyan-600 dark:bg-cyan-500">
          <Timer className="size-3 text-white dark:text-slate-900" />
        </div>
        <div className="flex min-w-0 flex-col text-xs">
          <span className="font-medium text-cyan-700 dark:text-cyan-400">
            {runAt === null ? "Delayed" : `Runs at ${formatMoment(runAt, now)}`}
          </span>
          {runAt === null ? null : (
            <span className={clsx("tabular-nums", TEXT_MUTED)}>
              {runAt > now ? `in ${formatDuration(runAt - now)}` : "due now"}
            </span>
          )}
        </div>
      </div>

      {onReschedule ? (
        <button
          type="button"
          onClick={onReschedule}
          className="ml-auto rounded text-xs font-medium text-gray-500 transition-colors duration-150 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none dark:text-slate-400 dark:hover:text-white"
        >
          Reschedule
        </button>
      ) : null}
    </div>
  );
};

export const JobTimeline = ({
  job,
  status,
  onReschedule,
}: JobTimelineProps) => {
  if (status === "delayed") {
    return <DelayedTimeline job={job} onReschedule={onReschedule} />;
  }

  const addedAt = job.createdAt ? new Date(job.createdAt) : null;
  const processedAt = job.processedAt ? new Date(job.processedAt) : null;
  const finishedAt = job.finishedAt ? new Date(job.finishedAt) : null;
  const hasFailed = isFailedJob(job, status);
  const OutcomeIcon = STATUS_ICONS[hasFailed ? "failed" : "completed"];

  const waitDuration =
    addedAt && processedAt ? processedAt.getTime() - addedAt.getTime() : null;

  const isProcessing = isRunningJob(job, status);
  const processDuration =
    processedAt && finishedAt
      ? finishedAt.getTime() - processedAt.getTime()
      : processedAt && isProcessing
        ? Date.now() - processedAt.getTime()
        : null;

  const isFinished = !!finishedAt;

  // The job panel no longer repeats these as an absolute-time grid, so each
  // stage carries its wall-clock moment on hover.
  const stageTitle = (label: string, date: Date | null) =>
    date ? `${label} ${formatAbsoluteTimestamp(date, "full")}` : undefined;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div
        className="flex min-w-0 items-center gap-2"
        title={stageTitle("Added", addedAt)}
      >
        <div
          className={clsx(
            "flex size-6 shrink-0 items-center justify-center rounded-full",
            processedAt
              ? "bg-gray-100 dark:bg-slate-800"
              : "bg-gray-900 dark:bg-slate-100",
          )}
        >
          <Clock
            className={clsx(
              "size-3",
              processedAt
                ? "text-gray-500 dark:text-slate-400"
                : "text-white dark:text-slate-900",
            )}
          />
        </div>
        <div className="flex min-w-0 flex-col">
          <span
            className={clsx(
              "text-xs font-medium",
              processedAt
                ? "text-gray-500 dark:text-slate-400"
                : "text-gray-900 dark:text-white",
            )}
          >
            Waiting
          </span>
          {waitDuration ? (
            <span className={clsx("text-xs tabular-nums", TEXT_MUTED)}>
              {formatDuration(waitDuration)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="h-px min-w-[20px] flex-1 bg-gray-100 dark:bg-slate-800" />

      <div
        className="flex min-w-0 items-center gap-2"
        title={stageTitle("Started", processedAt)}
      >
        <div
          className={clsx(
            "flex size-6 shrink-0 items-center justify-center rounded-full",
            isProcessing
              ? "animate-heartbeat bg-gray-900 dark:bg-slate-100"
              : "bg-gray-100 dark:bg-slate-800",
          )}
        >
          <Rocket
            className={clsx(
              "size-3",
              isProcessing
                ? "text-white dark:text-slate-900"
                : finishedAt
                  ? "text-gray-500 dark:text-slate-400"
                  : "text-gray-400 dark:text-slate-500",
            )}
          />
        </div>
        <div className="flex min-w-0 flex-col">
          <span
            className={clsx(
              "text-xs font-medium",
              isProcessing
                ? "text-gray-900 dark:text-white"
                : finishedAt
                  ? "text-gray-500 dark:text-slate-400"
                  : "text-gray-400 dark:text-slate-500",
            )}
          >
            Processing
          </span>
          {processDuration ? (
            <span className={clsx("text-xs tabular-nums", TEXT_MUTED)}>
              {formatDuration(processDuration)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="h-px min-w-[20px] flex-1 bg-gray-100 dark:bg-slate-800" />

      <div
        className="flex min-w-0 items-center gap-2"
        title={stageTitle("Finished", finishedAt)}
      >
        <div
          className={clsx(
            "flex size-6 shrink-0 items-center justify-center rounded-full",
            isFinished
              ? hasFailed
                ? "bg-red-500 dark:bg-red-600"
                : "bg-green-500 dark:bg-green-600"
              : "bg-gray-100 dark:bg-slate-800",
          )}
        >
          <OutcomeIcon
            className={clsx(
              "size-3",
              isFinished ? "text-white" : "text-gray-400 dark:text-slate-500",
            )}
          />
        </div>
        <div className="flex min-w-0 flex-col">
          <span
            className={clsx(
              "text-xs font-medium",
              isFinished
                ? hasFailed
                  ? "text-red-600 dark:text-red-400"
                  : "text-green-600 dark:text-green-400"
                : "text-gray-400 dark:text-slate-500",
            )}
          >
            {hasFailed ? "Failed" : "Completed"}
          </span>
          {finishedAt ? (
            <span className={clsx("text-xs tabular-nums", TEXT_MUTED)}>
              <Timestamp value={finishedAt} variant="time" />
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
};
