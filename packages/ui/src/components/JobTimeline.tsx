import { clsx } from "clsx";
import { CheckCircle, Clock, Rocket } from "lucide-react";

import { formatDuration } from "../utils/format";
import { TEXT_MUTED } from "../utils/styles";
import type { Job } from "../utils/trpc";
import { formatAbsoluteTimestamp, Timestamp } from "./Timestamp";

type JobTimelineProps = {
  job: Job;
};

export const JobTimeline = ({ job }: JobTimelineProps) => {
  const addedAt = job.createdAt ? new Date(job.createdAt) : null;
  const processedAt = job.processedAt ? new Date(job.processedAt) : null;
  const finishedAt = job.finishedAt ? new Date(job.finishedAt) : null;
  const hasFailed = !!job.failedReason;

  const waitDuration =
    addedAt && processedAt ? processedAt.getTime() - addedAt.getTime() : null;

  const processDuration =
    processedAt && finishedAt
      ? finishedAt.getTime() - processedAt.getTime()
      : processedAt
        ? Date.now() - processedAt.getTime()
        : null;

  const isProcessing = !!processedAt && !finishedAt;
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
          <CheckCircle
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
