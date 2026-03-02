import { clsx } from "clsx";
import { CheckCircle, Clock, Rocket } from "lucide-react";
import type { Job } from "../utils/trpc";

type JobTimelineProps = {
  job: Job;
};

const formatDuration = (ms: number) => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
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
              <span className="text-xs tabular-nums text-gray-400 dark:text-slate-500">
                {formatDuration(waitDuration)}
              </span>
            ) : null}
          </div>
        </div>

        <div className="h-px min-w-[20px] flex-1 bg-gray-100 dark:bg-slate-800" />

        <div className="flex min-w-0 items-center gap-2">
          <div
            className={clsx(
              "flex size-6 shrink-0 items-center justify-center rounded-full",
              isProcessing
                ? "animate-pulse bg-gray-900 dark:bg-slate-100"
                : finishedAt
                  ? "bg-gray-100 dark:bg-slate-800"
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
              <span className="text-xs tabular-nums text-gray-400 dark:text-slate-500">
                {formatDuration(processDuration)}
              </span>
            ) : null}
          </div>
        </div>

        <div className="h-px min-w-[20px] flex-1 bg-gray-100 dark:bg-slate-800" />

        <div className="flex min-w-0 items-center gap-2">
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
              {hasFailed ? "Failed" : "Complete"}
            </span>
            {finishedAt ? (
              <span className="text-xs tabular-nums text-gray-400 dark:text-slate-500">
                {finishedAt.toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
