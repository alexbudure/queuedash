import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { clsx } from "clsx";
import {
  ArrowRight,
  Bug,
  Check,
  Clock,
  FilterX,
  Loader2,
  Plus,
  PlusCircle,
  Rocket,
  RotateCcw,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useInView } from "react-intersection-observer";

import {
  type DateRange,
  describeDateRange,
  hasDateRange,
  toDateRangeInput,
} from "../utils/dateRange";
import { formatJobId } from "../utils/flow";
import { formatCount, formatDuration } from "../utils/format";
import {
  BULK_VERBS,
  bulkResultToast,
  mutationToasts,
} from "../utils/mutationToasts";
import {
  CARD_BORDER,
  FLOATING_BAR_DOCK,
  FOCUS_RING,
  HIT_AREA,
  TEXT_FAINT,
  TEXT_MUTED,
} from "../utils/styles";
import type { Job, RouterOutput, Status } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { PHONE_MEDIA_QUERY, useMediaQuery } from "../utils/useMediaQuery";
import {
  canSelectJobRows,
  formatJobCountLabel,
  getJobRowAriaLabel,
  getJobRowId,
  getJobSelectionAriaLabel,
  getRowRangeSelection,
  getStatusDisplayName,
  getTableCellPaddingClassName,
  getTableGridClassName,
  getTableHeaderPaddingClassName,
  getTableMinWidthClassName,
  isJobListPollingPaused,
  isShortcutExemptTarget,
  type JobSort,
} from "../utils/viewState";
import { AddJobModal } from "./AddJobModal";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { JobModal } from "./JobModal";
import { JobTableSkeleton } from "./JobTableSkeleton";
import { useQueuedash } from "./QueuedashProvider";
import { TableFrame } from "./TableFrame";
import { TableRow } from "./TableRow";
import { Timestamp } from "./Timestamp";
import { Tooltip } from "./Tooltip";

/** The durations are the one thing in the lifecycle cell that has to align
 *  column to column, so they - and not the relative dates beside them - are
 *  what gets the monospace figures. */

const durationValueClassName = "font-mono tabular-nums";

const lifecycleDateLabelClassName =
  "inline-block w-[7.5rem] whitespace-nowrap text-xs tabular-nums text-gray-500 transition-colors group-hover/tooltip:text-gray-700 dark:text-slate-400 dark:group-hover/tooltip:text-slate-300";

const lifecycleTimeLabelClassName =
  "inline-block w-[4.75rem] whitespace-nowrap text-xs tabular-nums text-gray-500 transition-colors group-hover/tooltip:text-gray-700 dark:text-slate-400 dark:group-hover/tooltip:text-slate-300";

/** Both indicators paint into the same 20px box so a row with a stack trace is
 *  not 2px taller than one without. */
const indicatorClassName = "flex size-5 items-center justify-center";

/**
 * What an empty tab means, per status. "No jobs found" was the same sentence
 * for a queue that has never failed and a queue whose completed list was just
 * cleaned, and it read as a fault in both.
 */
const EMPTY_STATE_COPY: Record<Status, { title: string; message: string }> = {
  active: {
    title: "No active jobs",
    message: "Jobs appear here for as long as a worker is running them.",
  },
  completed: {
    title: "No completed jobs",
    message:
      "Jobs move here once a worker finishes them. A queue that trims its history keeps this list short by design.",
  },
  delayed: {
    title: "No delayed jobs",
    message:
      "Jobs scheduled for later, or backing off between attempts, wait here until they are due.",
  },
  failed: {
    title: "No failed jobs",
    message:
      "Jobs land here once they run out of attempts. Nothing in this queue has.",
  },
  paused: {
    title: "No paused jobs",
    message:
      "While the queue is paused, jobs added to it collect here instead of being picked up.",
  },
  prioritized: {
    title: "No prioritized jobs",
    message:
      "Jobs added with an explicit priority wait here, and workers take the highest one first.",
  },
  waiting: {
    title: "No waiting jobs",
    message:
      "Jobs queue here until a worker is free. An empty list means the workers are keeping up.",
  },
  "waiting-children": {
    title: "No jobs waiting on children",
    message:
      "A parent job waits here until every child job it depends on has finished.",
  },
};

/** Adding a job is only an answer where the new job would actually show up.
 *  Offering it under "failed" proposed making work as the cure for having none
 *  of it go wrong. */
const ADD_JOB_STATUSES: Status[] = [
  "waiting",
  "delayed",
  "prioritized",
  "paused",
];

const columnHelper = createColumnHelper<Job & { status: Status }>();

const createColumns = (onCheckboxClick: (jobId: string) => void) => [
  columnHelper.display({
    id: "select",
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all displayed jobs"
        className={HIT_AREA}
        {...{
          checked: table.getIsSomeRowsSelected()
            ? "indeterminate"
            : table.getIsAllRowsSelected(),
          onCheckedChange: () => {
            table.toggleAllRowsSelected();
          },
        }}
      />
    ),
    // Painted at rest rather than revealed on hover: the header renders a
    // "select all displayed jobs" box unconditionally, and it used to sit above
    // a column with no visible "these" to select.
    cell: ({ row }) => (
      <Checkbox
        aria-label={getJobSelectionAriaLabel(row.original)}
        className={HIT_AREA}
        {...{
          checked: row.getIsSomeSelected()
            ? "indeterminate"
            : row.getIsSelected(),
          onCheckedChange: (checked) => {
            row.getToggleSelectedHandler()(checked);
            onCheckboxClick(row.original.id);
          },
        }}
      />
    ),
  }),
  columnHelper.accessor("name", {
    header: "Job",
    cell: (props) => {
      const job = props.cell.row.original;
      const hasName = job.name && job.name.trim() !== "";
      return (
        <Tooltip
          whenTruncated
          content={
            <div className="space-y-0.5">
              {hasName ? (
                <>
                  <div className="font-mono text-xs">{job.name}</div>
                  <div className="font-mono text-xs text-gray-400">
                    #{job.id}
                  </div>
                </>
              ) : (
                <div className="font-mono text-xs">#{job.id}</div>
              )}
            </div>
          }
        >
          <span className="flex min-w-0 items-center gap-3 py-1 pr-6">
            <span className="min-w-0 flex-1 truncate font-mono text-sm text-gray-900 dark:text-white">
              {hasName ? job.name : job.id}
            </span>
            {hasName ? (
              // Capped rather than `shrink-0`: a long `#repeat:<key>:<ts>` id
              // would otherwise never yield width and squeeze the job name,
              // which is the thing you actually scan for, down to "week…".
              <span className="max-w-[7rem] min-w-0 shrink truncate rounded-full bg-gray-100 px-1.5 font-mono text-[10px] text-gray-600 dark:bg-slate-800 dark:text-slate-300">
                #{formatJobId(job.id)}
              </span>
            ) : null}
          </span>
        </Tooltip>
      );
    },
  }),
  columnHelper.display({
    id: "lifecycle",
    // One label per segment, at the segments' own fixed widths, so the chips
    // say what they are without a hover: icon + date, then chip + time twice.
    header: () => (
      <span className="flex items-center gap-10">
        <span className="sr-only">Lifecycle: </span>
        <span className="w-[8.625rem]">Added</span>
        <span className="w-[9.125rem]">Waited</span>
        <span>Ran</span>
      </span>
    ),
    cell: ({ row: { original: job } }) => {
      const added = job.createdAt ? new Date(job.createdAt) : null;
      const processed = job.processedAt ? new Date(job.processedAt) : null;
      const finished = job.finishedAt ? new Date(job.finishedAt) : null;
      const failed = job.status === "failed";
      const isTerminalState =
        job.status === "completed" || job.status === "failed";

      if (!added) return null;

      const processingDuration =
        finished && processed ? finished.getTime() - processed.getTime() : null;

      const isWaitingState =
        job.status === "waiting" ||
        job.status === "delayed" ||
        job.status === "paused" ||
        job.status === "prioritized";

      return (
        <div className="flex min-w-0 items-center gap-10">
          {/* Added / Retried date */}
          <Tooltip
            content={
              job.retriedAt ? (
                <div className="space-y-0.5">
                  <div>
                    Retried <Timestamp value={job.retriedAt} />
                  </div>
                  <div className="text-[10px] text-slate-300">
                    Originally added <Timestamp value={added} />
                  </div>
                </div>
              ) : (
                <>
                  Added to queue <Timestamp value={added} />
                </>
              )
            }
          >
            <span className="flex shrink-0 items-center gap-1.5">
              {job.retriedAt ? (
                <RotateCcw className="size-3 shrink-0 text-purple-500 dark:text-purple-400" />
              ) : (
                <PlusCircle className={clsx("size-3 shrink-0", TEXT_FAINT)} />
              )}
              <span className={lifecycleDateLabelClassName}>
                <Timestamp value={job.retriedAt || job.createdAt} />
              </span>
            </span>
          </Tooltip>

          {/* State-specific content */}
          {isWaitingState ? (
            <Tooltip content="Waiting to be processed">
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="inline-flex h-5 min-w-16 items-center justify-between space-x-1 rounded-full bg-amber-50 px-1.5 whitespace-nowrap dark:bg-amber-950/50">
                  <span
                    className={clsx(
                      "w-14 text-[10px] text-amber-700 dark:text-amber-400",
                      durationValueClassName,
                    )}
                  >
                    {formatDuration(Date.now() - added.getTime())}
                  </span>
                  <Clock className="size-3 text-amber-500 dark:text-amber-400" />
                </span>
              </span>
            </Tooltip>
          ) : job.status === "active" && processed ? (
            <>
              <span className="flex shrink-0 items-center gap-1.5">
                <Tooltip
                  content={
                    <>
                      Waited{" "}
                      {formatDuration(processed.getTime() - added.getTime())}{" "}
                      before processing
                    </>
                  }
                >
                  <span className="inline-flex h-5 min-w-16 items-center justify-between space-x-1 rounded-full bg-gray-50 px-1.5 whitespace-nowrap transition-colors group-hover/tooltip:bg-gray-100 dark:bg-slate-800 dark:group-hover/tooltip:bg-slate-700">
                    <span
                      className={clsx(
                        "text-[10px] text-gray-600 dark:text-slate-300",
                        durationValueClassName,
                      )}
                    >
                      {formatDuration(processed.getTime() - added.getTime())}
                    </span>
                    <ArrowRight className={clsx("size-3", TEXT_FAINT)} />
                  </span>
                </Tooltip>
                <Tooltip
                  content={
                    <>
                      Processed at{" "}
                      <Timestamp value={job.processedAt} variant="full" />
                    </>
                  }
                >
                  <span className={lifecycleTimeLabelClassName}>
                    <Timestamp value={job.processedAt} variant="time" />
                  </span>
                </Tooltip>
              </span>

              <Tooltip
                content={
                  <>
                    Processing for{" "}
                    {formatDuration(Date.now() - processed.getTime())}
                  </>
                }
              >
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="inline-flex h-5 min-w-16 items-center justify-between space-x-1 rounded-full bg-blue-50 px-1.5 whitespace-nowrap dark:bg-blue-950/50">
                    <span
                      className={clsx(
                        "w-14 text-[10px] text-blue-700 dark:text-blue-400",
                        durationValueClassName,
                      )}
                    >
                      {formatDuration(Date.now() - processed.getTime())}
                    </span>
                    <Loader2 className="size-3 animate-spin text-blue-500 dark:text-blue-400" />
                  </span>
                </span>
              </Tooltip>
            </>
          ) : job.status === "active" ? (
            <Tooltip content="Processing (timing data unavailable for this queue)">
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="inline-flex h-5 items-center gap-1 rounded-full bg-blue-50 px-2 dark:bg-blue-950/50">
                  <Loader2 className="size-3 animate-spin text-blue-500 dark:text-blue-400" />
                  <span className="text-[10px] text-blue-700 dark:text-blue-400">
                    Processing
                  </span>
                </span>
              </span>
            </Tooltip>
          ) : processed && finished ? (
            <>
              <span className="flex shrink-0 items-center gap-1.5">
                <Tooltip
                  content={
                    <>
                      Waited{" "}
                      {formatDuration(processed.getTime() - added.getTime())}{" "}
                      before processing
                    </>
                  }
                >
                  <span className="inline-flex h-5 min-w-16 items-center justify-between space-x-1 rounded-full bg-gray-50 px-1.5 whitespace-nowrap transition-colors group-hover/tooltip:bg-gray-100 dark:bg-slate-800 dark:group-hover/tooltip:bg-slate-700">
                    <span
                      className={clsx(
                        "text-[10px] text-gray-600 dark:text-slate-300",
                        durationValueClassName,
                      )}
                    >
                      {formatDuration(processed.getTime() - added.getTime())}
                    </span>
                    <ArrowRight className={clsx("size-3", TEXT_FAINT)} />
                  </span>
                </Tooltip>
                <Tooltip
                  content={
                    <>
                      Processed at{" "}
                      <Timestamp value={job.processedAt} variant="full" />
                    </>
                  }
                >
                  <span className={lifecycleTimeLabelClassName}>
                    <Timestamp value={job.processedAt} variant="time" />
                  </span>
                </Tooltip>
              </span>

              <span className="flex shrink-0 items-center gap-1.5">
                <Tooltip
                  content={
                    <>
                      {failed ? "Failed" : "Completed"} after{" "}
                      {formatDuration(processingDuration)} of processing
                    </>
                  }
                >
                  <span
                    className={`inline-flex h-5 min-w-16 items-center justify-between space-x-1 rounded-full px-1.5 whitespace-nowrap transition-colors ${
                      failed
                        ? "bg-red-50 group-hover/tooltip:bg-red-100 dark:bg-red-950/50 dark:group-hover/tooltip:bg-red-950/70"
                        : "bg-green-50 group-hover/tooltip:bg-green-100 dark:bg-green-950/50 dark:group-hover/tooltip:bg-green-950/70"
                    }`}
                  >
                    <span
                      className={clsx(
                        "text-[10px]",
                        durationValueClassName,
                        failed
                          ? "text-red-700 dark:text-red-400"
                          : "text-green-700 dark:text-green-400",
                      )}
                    >
                      {formatDuration(processingDuration)}
                    </span>
                    {failed ? (
                      <X className="size-3 text-red-500 dark:text-red-400" />
                    ) : (
                      <Check className="size-3 text-green-500 dark:text-green-400" />
                    )}
                  </span>
                </Tooltip>
                <Tooltip
                  content={
                    <>
                      {failed ? "Failed" : "Finished"} at{" "}
                      <Timestamp value={job.finishedAt} variant="full" />
                    </>
                  }
                >
                  <span className={lifecycleTimeLabelClassName}>
                    <Timestamp value={job.finishedAt} variant="time" />
                  </span>
                </Tooltip>
              </span>
            </>
          ) : isTerminalState ? (
            <span className="flex shrink-0 items-center gap-1.5">
              <Tooltip
                content={
                  failed
                    ? "Failed (timing data unavailable for this queue)"
                    : "Completed (timing data unavailable for this queue)"
                }
              >
                <span
                  className={`inline-flex h-5 items-center gap-1 rounded-full px-2 transition-colors ${
                    failed
                      ? "bg-red-50 group-hover/tooltip:bg-red-100 dark:bg-red-950/50 dark:group-hover/tooltip:bg-red-950/70"
                      : "bg-green-50 group-hover/tooltip:bg-green-100 dark:bg-green-950/50 dark:group-hover/tooltip:bg-green-950/70"
                  }`}
                >
                  {failed ? (
                    <X className="size-3 text-red-500 dark:text-red-400" />
                  ) : (
                    <Check className="size-3 text-green-500 dark:text-green-400" />
                  )}
                  <span
                    className={`text-[10px] ${
                      failed
                        ? "text-red-700 dark:text-red-400"
                        : "text-green-700 dark:text-green-400"
                    }`}
                  >
                    {failed ? "Failed" : "Completed"}
                  </span>
                </span>
              </Tooltip>
              {finished ? (
                <Tooltip
                  content={
                    <>
                      {failed ? "Failed" : "Finished"} at{" "}
                      <Timestamp value={job.finishedAt} variant="full" />
                    </>
                  }
                >
                  <span className={lifecycleTimeLabelClassName}>
                    <Timestamp value={job.finishedAt} variant="time" />
                  </span>
                </Tooltip>
              ) : (
                <span
                  className={clsx("text-[10px] whitespace-nowrap", TEXT_MUTED)}
                >
                  no timing
                </span>
              )}
            </span>
          ) : null}
        </div>
      );
    },
  }),
  columnHelper.display({
    id: "metadata",
    header: "",
    cell: ({ row: { original: job } }) => (
      <div className="flex items-center gap-1.5">
        {job.attemptsMade != null && job.attemptsMade > 1 ? (
          <Tooltip
            content={
              job.opts.attempts
                ? `Attempt ${job.attemptsMade} of ${job.opts.attempts}`
                : `Retried ${job.attemptsMade - 1} time${job.attemptsMade > 2 ? "s" : ""}`
            }
          >
            <span
              className={clsx(
                indicatorClassName,
                "rounded-full bg-purple-50 transition-colors group-hover/tooltip:bg-purple-100 dark:bg-purple-950/40 dark:group-hover/tooltip:bg-purple-950/60",
              )}
            >
              <RotateCw className="size-3 text-purple-500 dark:text-purple-400" />
              <span className="sr-only">Retried</span>
            </span>
          </Tooltip>
        ) : null}
        {job.stacktrace && job.stacktrace.length > 0 ? (
          <Tooltip content="Has stack trace">
            <span className={indicatorClassName}>
              <Bug className="size-3.5 text-red-500 dark:text-red-400" />
              <span className="sr-only">Has stack trace</span>
            </span>
          </Tooltip>
        ) : null}
      </div>
    ),
  }),
];

const PHONE_CHIP =
  "inline-flex h-[22px] shrink-0 items-center gap-1 rounded-md px-[7px] font-mono text-[11px]";

/**
 * A job as a phone lists it: the name, with the id faint beside it, then how
 * it ended, when, and how long it waited. The lifecycle columns need 540px,
 * so on a phone they sat off-screen with the job's status in them.
 */
const PhoneJobSummary = ({ job }: { job: Job & { status: Status } }) => {
  const hasName = Boolean(job.name && job.name.trim() !== "");
  const added = job.createdAt ? new Date(job.createdAt) : null;
  const processed = job.processedAt ? new Date(job.processedAt) : null;
  const finished = job.finishedAt ? new Date(job.finishedAt) : null;
  const isFinished = job.status === "completed" || job.status === "failed";
  const failed = job.status === "failed";
  const waited =
    added && processed
      ? formatDuration(processed.getTime() - added.getTime())
      : null;

  let chip: ReactNode = null;
  let moment: ReactNode = null;
  if (isFinished) {
    const ran =
      processed && finished ? finished.getTime() - processed.getTime() : null;
    chip = (
      <span
        className={clsx(
          PHONE_CHIP,
          failed
            ? "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400"
            : "bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-400",
        )}
      >
        {ran === null ? (failed ? "Failed" : "Done") : formatDuration(ran)}
        {failed ? (
          <X aria-hidden="true" className="size-[11px]" />
        ) : (
          <Check aria-hidden="true" className="size-[11px]" />
        )}
      </span>
    );
    moment = finished ? (
      <span>
        {failed ? "failed" : "finished"}{" "}
        <Timestamp value={finished} variant="time" />
      </span>
    ) : (
      <span>no timing</span>
    );
  } else if (job.status === "active") {
    chip = (
      <span
        className={clsx(
          PHONE_CHIP,
          "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
        )}
      >
        {processed
          ? formatDuration(Date.now() - processed.getTime())
          : "Running"}
        <Loader2 aria-hidden="true" className="size-[11px] animate-spin" />
      </span>
    );
    moment = processed ? (
      <span>
        started <Timestamp value={processed} variant="time" />
      </span>
    ) : null;
  } else if (added) {
    chip = (
      <span
        className={clsx(
          PHONE_CHIP,
          "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
        )}
      >
        {formatDuration(Date.now() - added.getTime())}
        <Clock aria-hidden="true" className="size-[11px]" />
      </span>
    );
    moment =
      job.status === "delayed" && job.runAt ? (
        <span>
          due <Timestamp value={job.runAt} variant="time" />
        </span>
      ) : (
        <span>
          added <Timestamp value={added} variant="time" />
        </span>
      );
  }

  return (
    <div className="min-w-0 flex-1 py-1.5">
      <div className="flex min-w-0 items-baseline justify-between gap-2.5">
        <span className="min-w-0 truncate font-mono text-[13px] leading-5 text-gray-900 dark:text-white">
          {hasName ? job.name : `#${job.id}`}
        </span>
        {hasName ? (
          <span className="shrink-0 font-mono text-[11px] text-gray-400 dark:text-slate-500">
            #{formatJobId(job.id)}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex min-w-0 items-center gap-2 overflow-hidden text-xs leading-4 whitespace-nowrap text-gray-500 tabular-nums dark:text-slate-400">
        {chip}
        {moment}
        {(isFinished || job.status === "active") && waited ? (
          <>
            <span aria-hidden="true" className={TEXT_FAINT}>
              ·
            </span>
            <span>waited {waited}</span>
          </>
        ) : null}
      </div>
    </div>
  );
};

/** What a phone's list header says about the order, since its sort control
 *  is an icon. */
const getSortHint = (status: Status, sort: JobSort, queueType?: string) => {
  if (sort === "newest") return "Newest created first";
  if (sort === "oldest") return "Oldest created first";
  // BullMQ and Bull keep finished jobs sorted by when they finished.
  if (queueType === "bullmq" || queueType === "bull") {
    if (status === "failed") return "Newest failure first";
    if (status === "completed") return "Newest finish first";
  }
  return "Queue order";
};

type JobTableProps = {
  jobs: (Job & { status: Status })[];
  queueName: string;
  totalJobs: number;
  onBottomInView: () => void;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  status: Status;
  queue?: RouterOutput["queue"]["byName"];
  selectedGroupId?: string | null;
  // An error group's fingerprint: the list, and its bulk actions, cover only
  // that group's jobs.
  errorFingerprint?: string | null;
  /** A job name from the Job types tab: the list, and its bulk actions,
   *  cover only jobs added under it. */
  jobName?: string | null;
  query?: string;
  dateRange?: DateRange;
  sort?: JobSort;
  searchIsPartial?: boolean;
  /** Number of infinite-query pages currently loaded. Live polling stops after
   *  the first one, which the footer explains. */
  loadedPageCount?: number;
  /** Drops back to a single page so live polling can resume. */
  onResetPages?: () => void;
  /** How many jobs the server scanned to build this page, from its search metadata. */
  scannedCount?: number;
  /** Clears the search query and the group filter. */
  onClearFilters?: () => void;
  /** Controlled open job. Omit to let the table own it. */
  selectedJobId?: string | null;
  onSelectJob?: (jobId: string | null) => void;
  /** Closes the panel only if it is still on `jobId`. For an action that
   *  settles after the reader may have moved on to another job. */
  onJobLeft?: (jobId: string) => void;
  /** Steps the open job without growing history; the page owns how. */
  onStepJob?: (delta: 1 | -1) => void;
};
const EMPTY_RANGE: DateRange = {};
const DOCK_BUTTON_CLASS = "max-sm:h-10";
// By-filter actions work through the same bounded scan the list does.
const SCAN_LIMIT_NOTE = "A very long list stops at the server's scan limit.";

export const JobTable = ({
  jobs,
  totalJobs,
  onBottomInView,
  isLoading,
  isFetchingNextPage,
  queueName,
  status,
  queue,
  selectedGroupId,
  errorFingerprint,
  jobName,
  query,
  dateRange = EMPTY_RANGE,
  sort = "queue",
  searchIsPartial = false,
  loadedPageCount,
  onResetPages,
  scannedCount,
  onClearFilters,
  selectedJobId,
  onSelectJob,
  onJobLeft,
  onStepJob,
}: JobTableProps) => {
  const { preferences, portalContainer } = useQueuedash();
  const isPhone = useMediaQuery(PHONE_MEDIA_QUERY);
  const [rowSelection, setRowSelection] = useState({});
  const [showAddJobModal, setShowAddJobModal] = useState(false);
  const lastClickedJobIdRef = useRef<string | null>(null);
  const statusLabel = getStatusDisplayName(status);
  const canSelectRows = canSelectJobRows({
    actions: queue?.access.actions,
    status,
    supportsRetry: queue?.supports.retry,
  });
  const { ref } = useInView({
    threshold: 0,
    onChange(inView) {
      if (inView) {
        onBottomInView();
      }
    },
  });
  const handleCheckboxClick = useCallback((jobId: string) => {
    lastClickedJobIdRef.current = jobId;
  }, []);
  const columns = useMemo(() => {
    const jobColumns = createColumns(handleCheckboxClick);
    return canSelectRows ? jobColumns : jobColumns.slice(1);
  }, [canSelectRows, handleCheckboxClick]);
  const table = useReactTable({
    data: jobs,
    columns,
    enableRowSelection: canSelectRows,
    getRowId: getJobRowId,
    getCoreRowModel: getCoreRowModel(),
    state: {
      rowSelection,
    },
    onRowSelectionChange: setRowSelection,
  });
  const isEmpty = jobs.length === 0;
  // The open job is controlled when the page keeps it in the URL, and owned
  // here otherwise.
  const [ownedJobId, setOwnedJobId] = useState<string | null>(null);
  const openJobId = selectedJobId === undefined ? ownedJobId : selectedJobId;
  // A job that changes status drops out of `jobs` on the next poll. Deriving
  // straight from the list would unmount the panel under the reader mid-read,
  // so the last resolved job is retained until the panel is actually closed -
  // but only for the id it was resolved for, or a `?job=` changed by Back or a
  // link kept showing the previous job under the new id.
  const lastOpenJobRef = useRef<(Job & { status: Status | null }) | null>(null);
  const listedJob = openJobId
    ? (jobs.find((job) => job.id === openJobId) ?? null)
    : null;
  if (listedJob) lastOpenJobRef.current = listedJob;
  if (lastOpenJobRef.current?.id !== openJobId) lastOpenJobRef.current = null;
  // An open job the loaded pages don't reach - a "Search all statuses" result,
  // or a shared link deeper than page one - is fetched by id, where it used to
  // open nothing. The panel's live query shares this key, so it is the request
  // the panel makes anyway.
  const jobLookup = trpc.job.byId.useQuery(
    { queueName, jobId: openJobId ?? "" },
    {
      enabled: !!openJobId && !lastOpenJobRef.current && !isLoading,
      retry: false,
    },
  );
  if (
    !lastOpenJobRef.current &&
    openJobId &&
    jobLookup.data?.id === openJobId
  ) {
    lastOpenJobRef.current = {
      ...jobLookup.data,
      status: jobLookup.data.status ?? null,
    };
  }
  const selectedJob = lastOpenJobRef.current;
  // Still unresolved once the list has loaded. Under identity redaction the
  // lookup is refused outright, so this is the only answer the link gets.
  const jobLookupNotice =
    openJobId && !selectedJob && !isLoading
      ? jobLookup.error?.data?.code === "FORBIDDEN"
        ? {
            title: "Not in the loaded list",
            message: `Job ${openJobId} isn't among the ${statusLabel} jobs loaded so far, and jobs can't be looked up by id while their ids are redacted. Scroll to load more, or change the filter.`,
          }
        : jobLookup.isError
          ? {
              title: "Could not load this job",
              message: jobLookup.error.message,
            }
          : jobLookup.data === null
            ? {
                title: "Job not found",
                message: `There is no job ${openJobId} in this queue. It may have been removed, or the link may be out of date.`,
              }
            : null
      : null;
  const selectJob = (jobId: string | null) => {
    if (onSelectJob) onSelectJob(jobId);
    else setOwnedJobId(jobId);
  };
  const leaveJob = (jobId: string) => {
    if (onJobLeft) onJobLeft(jobId);
    else if (onSelectJob) {
      if (openJobId === jobId) onSelectJob(null);
    } else setOwnedJobId((current) => (current === jobId ? null : current));
  };
  const openJobIndex = openJobId
    ? jobs.findIndex((job) => job.id === openJobId)
    : -1;
  const stepJob = (delta: 1 | -1) => {
    if (onStepJob) {
      onStepJob(delta);
      return;
    }
    const neighbour = jobs[openJobIndex + delta];
    if (openJobIndex >= 0 && neighbour) selectJob(neighbour.id);
  };

  // No per-job toasts: `handleBulkRerun` reports one summary for the whole
  // selection instead of one banner per job.
  const { mutateAsync: rerunAsync } = trpc.job.rerun.useMutation();
  const [isRerunning, setIsRerunning] = useState(false);

  const { mutate: bulkRetrySelected, status: bulkRetrySelectedStatus } =
    trpc.job.bulkRetry.useMutation(
      mutationToasts<RouterOutput["job"]["bulkRetry"]>("Jobs retried", {
        showSuccessToast: false,
        errorMessage: "Could not retry the selected jobs",
        onSuccess(result) {
          bulkResultToast(BULK_VERBS.retry, "job", result);
          // Kept until the request settles so a failure leaves the selection
          // intact to try again.
          table.resetRowSelection();
        },
      }),
    );

  const { mutate: bulkRemoveSelected, status: bulkRemoveSelectedStatus } =
    trpc.job.bulkRemove.useMutation(
      mutationToasts<RouterOutput["job"]["bulkRemove"]>("Jobs removed", {
        showSuccessToast: false,
        errorMessage: "Could not remove the selected jobs",
        // The server's own tally: every id sent used to be reported removed,
        // including ones that were already gone.
        onSuccess(result) {
          bulkResultToast(BULK_VERBS.remove, "job", result);
          table.resetRowSelection();
        },
      }),
    );

  const { mutate: bulkRemoveByFilter, status: bulkRemoveByFilterStatus } =
    trpc.job.bulkRemoveByFilter.useMutation(
      mutationToasts<RouterOutput["job"]["bulkRemoveByFilter"]>(
        "Jobs removed",
        {
          showSuccessToast: false,
          errorMessage: "Could not remove the jobs",
          onSuccess(result) {
            bulkResultToast(BULK_VERBS.remove, "job", result);
          },
        },
      ),
    );

  const { mutate: bulkPromote, status: bulkPromoteStatus } =
    trpc.job.bulkPromoteByFilter.useMutation(
      mutationToasts<RouterOutput["job"]["bulkPromoteByFilter"]>(
        "Jobs promoted",
        {
          showSuccessToast: false,
          errorMessage: "Could not promote the jobs",
          onSuccess(result) {
            bulkResultToast(BULK_VERBS.promote, "job", result);
          },
        },
      ),
    );

  const { mutate: cleanQueue, status: cleanQueueStatus } =
    trpc.queue.clean.useMutation(
      mutationToasts(`All ${statusLabel} jobs have been removed`, {
        errorMessage: `Could not remove the ${statusLabel} jobs`,
      }),
    );

  const { mutate: bulkRetry, status: bulkRetryStatus } =
    trpc.job.bulkRetryByFilter.useMutation(
      mutationToasts<RouterOutput["job"]["bulkRetryByFilter"]>("Jobs retried", {
        showSuccessToast: false,
        errorMessage: "Could not retry the jobs",
        onSuccess(result) {
          bulkResultToast(BULK_VERBS.retry, "job", result);
        },
      }),
    );

  const cleanSupport = queue?.supports.clean;
  const canCleanStatus =
    status !== "waiting-children" &&
    (cleanSupport === true ||
      (typeof cleanSupport === "object" &&
        cleanSupport.supportedStatuses.includes(status)));
  const hasRange = hasDateRange(dateRange);
  // "Matching" is for the filters a date phrase doesn't already describe.
  const hasSearchFilter = Boolean(
    query || selectedGroupId || errorFingerprint || jobName,
  );
  const hasFilter = hasSearchFilter || hasRange;
  const rangePhrase = hasRange ? describeDateRange(dateRange, status) : null;
  const rangeKey = JSON.stringify(dateRange);
  // What every by-filter action narrows to, so it acts on exactly the list.
  const filterInput = {
    groupId: selectedGroupId ?? undefined,
    query,
    name: jobName ?? undefined,
    ...toDateRangeInput(dateRange),
  };
  const emptyStateCopy = EMPTY_STATE_COPY[status];
  const canAddJob =
    queue?.access.actions["job.add"] === true &&
    ADD_JOB_STATUSES.includes(status);
  const showCleanAll =
    totalJobs > 0 &&
    !hasFilter &&
    canCleanStatus &&
    queue?.access.actions["queue.clean"] === true;
  const showRemoveAll =
    totalJobs > 0 &&
    !showCleanAll &&
    queue?.access.actions["job.remove"] === true;
  const showRetryAll =
    totalJobs > 0 &&
    status === "failed" &&
    !!queue?.supports.retry &&
    queue.access.actions["job.retry"];
  // Promoting by filter cannot narrow to an error group, so it is not offered
  // while one is shown: it would promote every delayed job instead.
  const showPromoteAll =
    totalJobs > 0 &&
    !errorFingerprint &&
    status === "delayed" &&
    !!queue?.supports.promote &&
    queue.access.actions["job.promote"];

  const dockButtonSize = isPhone ? "lg" : "sm";

  const selectedRows = table.getSelectedRowModel().rows;
  const selectedCount = selectedRows.length;
  const hasSelection = canSelectRows && selectedCount > 0;
  const canRetrySelection =
    status === "failed" &&
    !!queue?.supports.retry &&
    queue.access.actions["job.retry"] === true;
  const canRerunSelection =
    status === "completed" && queue?.access.actions["job.rerun"] === true;
  const countLabel = formatJobCountLabel({
    hasFilter: hasSearchFilter,
    status,
    total: totalJobs,
  });
  // "38 failed jobs in the last hour": what a by-filter action will touch.
  const actionSubject = `${searchIsPartial ? "at least " : ""}${countLabel}${
    rangePhrase ? ` ${rangePhrase}` : ""
  }`;
  // A capped search knows only a lower bound. The qualifier belongs to the
  // sentence rather than the count, so it opens the standalone phrase and
  // stays lower-case inside "3 of …".
  const isPollingPaused = isJobListPollingPaused(
    loadedPageCount ??
      Math.max(1, Math.ceil(jobs.length / preferences.jobsPerPage)),
    preferences.refreshIntervalMs,
  );
  // Once more than a page is loaded the count reads "90 of 147": how much of
  // the list is on screen is the fact the frozen rows need explained by.
  const footerLabel = hasSelection
    ? `${formatCount(selectedCount)} of ${
        searchIsPartial ? `at least ${countLabel}` : countLabel
      } selected`
    : searchIsPartial
      ? `At least ${countLabel}`
      : isPollingPaused && jobs.length < totalJobs
        ? `${formatCount(jobs.length)} of ${countLabel}`
        : countLabel;
  // "47 failed", "3 selected": the dock is one row on a phone.
  const phoneFooterCount = hasSelection
    ? formatCount(selectedCount)
    : `${formatCount(totalJobs)}${searchIsPartial ? "+" : ""}`;
  const phoneFooterNoun = hasSelection ? "selected" : statusLabel;
  const hasReachedEnd = !isEmpty && jobs.length >= totalJobs;
  const knownCount = queue ? (queue.counts[status] ?? 0) : null;
  // Without queue metadata there is no count to gate on yet, and skipping the
  // skeleton here is what used to flash "No jobs found" on every cold load.
  const showSkeleton = isLoading && (knownCount === null || knownCount > 0);
  // A list of at least a page ends in a 48px row - the load-more sentinel or
  // the terminus. The skeleton reserves the same row, or the frame grew by
  // that much (and the dock jumped) every time a status finished loading.
  const hasFooterRow =
    (isLoading ? (knownCount ?? preferences.jobsPerPage) : jobs.length) >=
    preferences.jobsPerPage;

  useEffect(() => {
    setRowSelection({});
    setOwnedJobId(null);
    lastClickedJobIdRef.current = null;
  }, [
    errorFingerprint,
    jobName,
    query,
    queueName,
    rangeKey,
    selectedGroupId,
    status,
  ]);

  useEffect(() => {
    if (!canSelectRows) {
      setRowSelection({});
      lastClickedJobIdRef.current = null;
    }
  }, [canSelectRows]);

  // Same target gate as QueuePage's shortcuts: embedded, Escape pressed
  // anywhere in the host app must not silently clear the user's selection here.
  useEffect(() => {
    if (!hasSelection || selectedJob) return;
    const root = portalContainer;
    if (!root) return;
    const doc = root.ownerDocument;
    const handleKeyDown = (event: KeyboardEvent) => {
      // An Escape another handler already acted on is spent, and one pressed
      // in a text field belongs to the field: clearing "Filter jobs" with it
      // used to wipe a selection built up row by row.
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        isShortcutExemptTarget(event.target)
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const isOurs =
        !target ||
        target === doc.body ||
        target === doc.documentElement ||
        root.contains(target);
      if (isOurs) table.resetRowSelection();
    };
    doc.addEventListener("keydown", handleKeyDown);
    return () => doc.removeEventListener("keydown", handleKeyDown);
  }, [hasSelection, portalContainer, selectedJob, table]);

  const handleRowClick = (
    event: React.MouseEvent<HTMLDivElement>,
    rowIndex: number,
  ) => {
    const rows = table.getRowModel().rows;
    const anchorIndex = rows.findIndex(
      (row) => row.original.id === lastClickedJobIdRef.current,
    );
    if (canSelectRows && event.shiftKey && anchorIndex >= 0) {
      event.preventDefault();
      setRowSelection({
        ...rowSelection,
        ...getRowRangeSelection(rows, anchorIndex, rowIndex),
      });
      return;
    }
    selectJob(rows[rowIndex].original.id);
    lastClickedJobIdRef.current = rows[rowIndex].original.id;
  };

  const handleBulkRerun = async () => {
    const jobIds = selectedRows.map((row) => row.original.id);
    setIsRerunning(true);
    // `rerun` has no bulk procedure, so the loop stays - but it now reports a
    // single summary instead of firing and forgetting.
    const results = await Promise.allSettled(
      jobIds.map((jobId) => rerunAsync({ queueName, jobId })),
    );
    setIsRerunning(false);
    const failed = results.filter(
      (result) => result.status === "rejected",
    ).length;
    bulkResultToast(BULK_VERBS.rerun, "job", {
      succeeded: jobIds.length - failed,
      failed,
    });
    table.resetRowSelection();
  };

  return (
    <div>
      {selectedJob ? (
        <JobModal
          queueName={queueName}
          job={selectedJob}
          status={selectedJob.status}
          onDismiss={() => selectJob(null)}
          onJobLeft={leaveJob}
          onStep={stepJob}
          canStepPrevious={openJobIndex > 0}
          canStepNext={openJobIndex >= 0 && openJobIndex < jobs.length - 1}
        />
      ) : null}
      {showAddJobModal && queue ? (
        <AddJobModal
          queue={queue}
          variant="job"
          onDismiss={() => setShowAddJobModal(false)}
        />
      ) : null}
      {jobLookupNotice ? (
        <div
          role="status"
          className={clsx(
            "mb-3 flex items-start justify-between gap-3 rounded-xl px-4 py-3",
            CARD_BORDER,
          )}
        >
          <div className="min-w-0 text-sm">
            <p className="font-medium text-gray-900 dark:text-white">
              {jobLookupNotice.title}
            </p>
            <p className={clsx("mt-0.5 break-words", TEXT_MUTED)}>
              {jobLookupNotice.message}
            </p>
          </div>
          <Button size="sm" label="Dismiss" onClick={() => selectJob(null)} />
        </div>
      ) : null}
      <TableFrame
        skeleton={
          showSkeleton ? (
            <JobTableSkeleton
              rows={Math.min(
                preferences.jobsPerPage,
                knownCount ?? preferences.jobsPerPage,
              )}
              selectable={canSelectRows}
              withFooterRow={hasFooterRow}
            />
          ) : undefined
        }
        className="max-sm:rounded-none max-sm:border-x-0 max-sm:border-t-0"
        header={table.getHeaderGroups().map((headerGroup) => (
          <div
            role="row"
            className={clsx(
              "grid px-2",
              getTableGridClassName("job", canSelectRows),
              getTableMinWidthClassName("job"),
              getTableHeaderPaddingClassName(preferences.density),
              "max-sm:h-9 max-sm:items-center",
            )}
            key={headerGroup.id}
          >
            {headerGroup.headers.map((header) => (
              <div
                role="columnheader"
                key={header.id}
                className={clsx(
                  "flex h-full items-center px-1.5 text-xs font-medium",
                  TEXT_MUTED,
                  header.column.id !== "select" && "max-sm:hidden",
                )}
              >
                {header.isPlaceholder
                  ? null
                  : flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
              </div>
            ))}
            <div
              role="columnheader"
              className={clsx(
                "flex h-full items-center justify-between gap-3 px-1.5 text-xs sm:hidden",
                TEXT_MUTED,
              )}
            >
              <span>
                {canSelectRows ? (
                  "Select all"
                ) : (
                  <span className="sr-only">Jobs</span>
                )}
              </span>
              <span className={TEXT_FAINT}>
                {getSortHint(status, sort, queue?.type)}
              </span>
            </div>
          </div>
        ))}
        footer={
          isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-1 px-6 py-12 text-center">
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {hasFilter ? "No matching jobs" : emptyStateCopy.title}
              </p>
              <p className={clsx("max-w-sm text-sm", TEXT_MUTED)}>
                {hasSearchFilter
                  ? `Nothing in the ${statusLabel} list matches these filters.`
                  : hasRange
                    ? `No ${statusLabel} jobs ${rangePhrase}.`
                    : emptyStateCopy.message}
              </p>
              {hasFilter && onClearFilters ? (
                <div className="mt-3">
                  <Button
                    label="Clear filters"
                    icon={<FilterX className="size-3.5" />}
                    size="sm"
                    onClick={onClearFilters}
                  />
                </div>
              ) : null}
              {!hasFilter && canAddJob ? (
                <div className="mt-3">
                  <Button
                    label="Add job"
                    icon={<Plus className="size-3.5" />}
                    size="sm"
                    onClick={() => setShowAddJobModal(true)}
                  />
                </div>
              ) : null}
            </div>
          ) : hasReachedEnd ? (
            // "End of list" under a single row is a caption for nothing: the
            // terminus only appears once the list ran at least a page. A
            // capped search cannot promise there is nothing further, and the
            // footer directly below says "At least N" - so it has to stop
            // claiming otherwise.
            hasFooterRow ? (
              <p className={clsx("py-4 text-center text-xs", TEXT_MUTED)}>
                {searchIsPartial
                  ? "End of the results scanned so far"
                  : "End of list"}
              </p>
            ) : null
          ) : (
            // Right after the last row, so the page only scrolls it into
            // view once the reader actually gets there.
            <div ref={ref} className="flex items-center justify-center py-4">
              {isFetchingNextPage ? (
                <div
                  className={clsx(
                    "flex items-center gap-2 text-xs",
                    TEXT_MUTED,
                  )}
                >
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Loading more…</span>
                </div>
              ) : (
                <div className="h-4" />
              )}
            </div>
          )
        }
      >
        {table.getRowModel().rows.map((row, rowIndex) => (
          <TableRow
            ariaLabel={getJobRowAriaLabel(row.original)}
            hasSeparator={table.getRowModel().rows.length !== rowIndex + 1}
            key={row.id}
            isSelected={canSelectRows && row.getIsSelected()}
            onClick={(event) => handleRowClick(event, rowIndex)}
            onKeyboardActivate={() => selectJob(row.original.id)}
            layoutVariant="job"
            selectable={canSelectRows}
          >
            {row.getVisibleCells().map((cell) => (
              <div
                role="cell"
                key={cell.id}
                className={clsx(
                  "flex h-full items-center px-1.5",
                  getTableCellPaddingClassName(preferences.density),
                  cell.column.id === "select"
                    ? "max-sm:items-start max-sm:pt-2.5"
                    : "max-sm:hidden",
                )}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </div>
            ))}
            <div role="cell" className="flex min-w-0 px-1.5 sm:hidden">
              <PhoneJobSummary job={row.original} />
            </div>
          </TableRow>
        ))}
      </TableFrame>

      {/* The footer is present whenever there are jobs, so a read-only user
          still gets a count and a terminus - it used to render only alongside
          bulk actions. An empty list has its own message and nothing to act
          on, so it gets no dock. */}
      {isEmpty && !isLoading ? null : (
        <div
          className={clsx(
            FLOATING_BAR_DOCK,
            // Below the sticky header, which must win when a row scrolls past it.
            "z-[5]",
            showSkeleton && "invisible",
          )}
        >
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-gray-200/60 bg-white/90 px-3 py-1.5 text-xs shadow-md backdrop-blur max-sm:w-full max-sm:flex-nowrap max-sm:rounded-full max-sm:py-2 max-sm:pr-2 max-sm:pl-4 max-sm:text-sm sm:rounded-full dark:border-slate-700/60 dark:bg-slate-900/90">
            {/* `tabular-nums` so the count does not shift the bar's width on
              every poll. */}
            <p
              className={clsx(
                "min-w-0 tabular-nums max-sm:flex-1 max-sm:truncate",
                TEXT_MUTED,
              )}
            >
              <span className="font-medium text-gray-900 max-sm:hidden dark:text-slate-100">
                {footerLabel}
              </span>
              <span className="sm:hidden">
                <span className="font-semibold text-gray-900 dark:text-white">
                  {phoneFooterCount}
                </span>{" "}
                {phoneFooterNoun}
              </span>
              {!hasSelection && rangePhrase ? (
                <span className="max-sm:hidden"> {rangePhrase}</span>
              ) : null}
              {/* What the count was built from. Only worth saying when a filter
                narrowed the scan, or when the server's cap cut it short. */}
              {!hasSelection &&
              scannedCount !== undefined &&
              (hasFilter || searchIsPartial) ? (
                <span
                  className={clsx(
                    "max-sm:hidden",
                    searchIsPartial
                      ? "text-amber-600 dark:text-amber-400"
                      : TEXT_FAINT,
                  )}
                >
                  {" · "}
                  {searchIsPartial
                    ? `scanned the first ${formatCount(scannedCount)}`
                    : `scanned ${formatCount(scannedCount)}`}
                </span>
              ) : null}
            </p>

            {/* The same dot language as the sidebar's Live indicator, and not
              the word "paused", which next to a queue means something else.
              The sentence it replaced was the longest thing in the dock and
              the least often needed; the chip carries it as a tooltip and
              resets on press. */}
            {isPollingPaused && !hasSelection ? (
              onResetPages ? (
                <button
                  type="button"
                  onClick={onResetPages}
                  title="This list stops updating once more than one page is loaded. Press to go back to the first page and resume live updates."
                  className={clsx(
                    "flex h-7 items-center gap-1.5 rounded-full px-2 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 active:bg-gray-200 dark:hover:bg-slate-800 dark:hover:text-white dark:active:bg-slate-700",
                    TEXT_MUTED,
                    FOCUS_RING,
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-gray-400 dark:bg-slate-500"
                  />
                  Not live
                  <span className="sr-only">
                    . This list stops updating once more than one page is
                    loaded; press to reset to the first page.
                  </span>
                </button>
              ) : (
                <span
                  className={clsx("flex items-center gap-1.5 px-1", TEXT_MUTED)}
                  title="This list stops updating once more than one page is loaded."
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-gray-400 dark:bg-slate-500"
                  />
                  Not live
                </span>
              )
            ) : null}

            {hasSelection ? (
              <>
                <Button
                  label="Clear"
                  icon={<X className="size-3.5" />}
                  size={dockButtonSize}
                  className={DOCK_BUTTON_CLASS}
                  onClick={() => table.resetRowSelection()}
                />

                {canRetrySelection || canRerunSelection ? (
                  <Button
                    label={canRetrySelection ? "Retry" : "Rerun"}
                    icon={<RotateCw className="size-3.5" />}
                    size={dockButtonSize}
                    className={DOCK_BUTTON_CLASS}
                    isLoading={
                      canRetrySelection
                        ? bulkRetrySelectedStatus === "pending"
                        : isRerunning
                    }
                    onClick={() => {
                      if (canRetrySelection) {
                        bulkRetrySelected({
                          queueName,
                          jobIds: selectedRows.map((row) => row.original.id),
                        });
                        return;
                      }
                      void handleBulkRerun();
                    }}
                  />
                ) : null}

                {queue?.access.actions["job.remove"] ? (
                  <Alert
                    isPending={bulkRemoveSelectedStatus === "pending"}
                    title={`Remove ${formatCount(selectedCount)} selected ${
                      selectedCount === 1 ? "job" : "jobs"
                    }?`}
                    description="They're deleted from the queue for good. This can't be undone."
                    action={
                      <Button
                        variant="filled"
                        colorScheme="red"
                        label="Yes, remove jobs"
                        onClick={() =>
                          bulkRemoveSelected({
                            queueName,
                            jobIds: selectedRows.map((row) => row.original.id),
                          })
                        }
                      />
                    }
                  >
                    <Button
                      as="span"
                      label="Remove"
                      icon={<Trash2 className="size-3.5" />}
                      size={dockButtonSize}
                      className={DOCK_BUTTON_CLASS}
                      isLoading={bulkRemoveSelectedStatus === "pending"}
                    />
                  </Alert>
                ) : null}
              </>
            ) : (
              <>
                {showRetryAll ? (
                  <Alert
                    isPending={bulkRetryStatus === "pending"}
                    title={`Retry ${actionSubject}?`}
                    description={`They go back to waiting and run again. ${SCAN_LIMIT_NOTE}`}
                    action={
                      <Button
                        variant="filled"
                        colorScheme="brand"
                        label="Yes, retry them"
                        onClick={() =>
                          bulkRetry({
                            queueName,
                            status: "failed",
                            error: errorFingerprint ?? undefined,
                            ...filterInput,
                          })
                        }
                      />
                    }
                  >
                    <Button
                      as="span"
                      icon={<RotateCw className="size-3.5" />}
                      label="Retry all"
                      size={dockButtonSize}
                      className={DOCK_BUTTON_CLASS}
                      isLoading={bulkRetryStatus === "pending"}
                    />
                  </Alert>
                ) : null}
                {showPromoteAll ? (
                  <Alert
                    isPending={bulkPromoteStatus === "pending"}
                    title={`Promote ${actionSubject}?`}
                    description={`They run now instead of waiting out their delay. ${SCAN_LIMIT_NOTE}`}
                    action={
                      <Button
                        variant="filled"
                        colorScheme="brand"
                        label="Yes, promote them"
                        onClick={() =>
                          bulkPromote({
                            queueName,
                            status: "delayed",
                            ...filterInput,
                          })
                        }
                      />
                    }
                  >
                    <Button
                      as="span"
                      icon={<Rocket className="size-3.5" />}
                      label="Promote all"
                      size={dockButtonSize}
                      className={DOCK_BUTTON_CLASS}
                      isLoading={bulkPromoteStatus === "pending"}
                    />
                  </Alert>
                ) : null}
                {showCleanAll ? (
                  <Alert
                    isPending={cleanQueueStatus === "pending"}
                    title={`Remove all ${statusLabel} jobs?`}
                    description={`Every ${statusLabel} job is deleted from the queue for good. This can't be undone.`}
                    action={
                      <Button
                        variant="filled"
                        colorScheme="red"
                        label="Yes, remove jobs"
                        onClick={() =>
                          cleanQueue({
                            queueName,
                            status,
                          })
                        }
                      />
                    }
                  >
                    <Button
                      as="span"
                      icon={<Trash2 className="size-3.5" />}
                      label={isPhone ? "Remove" : `Remove all ${statusLabel}`}
                      size={dockButtonSize}
                      className={DOCK_BUTTON_CLASS}
                      isLoading={cleanQueueStatus === "pending"}
                    />
                  </Alert>
                ) : null}
                {showRemoveAll ? (
                  <Alert
                    isPending={bulkRemoveByFilterStatus === "pending"}
                    title={`Remove ${actionSubject}?`}
                    description={`They're deleted from the queue for good. This can't be undone. ${SCAN_LIMIT_NOTE}`}
                    action={
                      <Button
                        variant="filled"
                        colorScheme="red"
                        label="Yes, remove them"
                        onClick={() =>
                          bulkRemoveByFilter({
                            queueName,
                            status,
                            error: errorFingerprint ?? undefined,
                            ...filterInput,
                          })
                        }
                      />
                    }
                  >
                    <Button
                      as="span"
                      icon={<Trash2 className="size-3.5" />}
                      label={isPhone ? "Remove" : "Remove all"}
                      size={dockButtonSize}
                      className={DOCK_BUTTON_CLASS}
                      isLoading={bulkRemoveByFilterStatus === "pending"}
                    />
                  </Alert>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
