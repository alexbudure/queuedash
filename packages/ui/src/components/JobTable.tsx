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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInView } from "react-intersection-observer";

import { formatCount, formatCountLabel, formatDuration } from "../utils/format";
import { bulkResultToast, mutationToasts } from "../utils/mutationToasts";
import {
  FLOATING_BAR_DOCK,
  FOCUS_RING,
  HIT_AREA,
  TEXT_FAINT,
  TEXT_MUTED,
} from "../utils/styles";
import type { Job, RouterOutput, Status } from "../utils/trpc";
import { trpc } from "../utils/trpc";
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
                #{job.id}
              </span>
            ) : null}
          </span>
        </Tooltip>
      );
    },
  }),
  columnHelper.display({
    id: "lifecycle",
    header: () => "Lifecycle",
    cell: ({ row: { original: job } }) => {
      const added = job.createdAt ? new Date(job.createdAt) : null;
      const processed = job.processedAt ? new Date(job.processedAt) : null;
      const finished = job.finishedAt ? new Date(job.finishedAt) : null;
      const failed = job.status === "failed" || !!job.failedReason;
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
  query?: string;
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
};
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
  query,
  searchIsPartial = false,
  loadedPageCount,
  onResetPages,
  scannedCount,
  onClearFilters,
  selectedJobId,
  onSelectJob,
}: JobTableProps) => {
  const { preferences, portalContainer } = useQueuedash();
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
  // so the last resolved job is retained until the panel is actually closed.
  const lastOpenJobRef = useRef<(Job & { status: Status }) | null>(null);
  const foundJob = openJobId
    ? (jobs.find((job) => job.id === openJobId) ?? null)
    : null;
  if (foundJob) lastOpenJobRef.current = foundJob;
  if (!openJobId) lastOpenJobRef.current = null;
  const selectedJob = openJobId ? (foundJob ?? lastOpenJobRef.current) : null;
  const selectJob = (jobId: string | null) => {
    if (onSelectJob) onSelectJob(jobId);
    else setOwnedJobId(jobId);
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
          bulkResultToast("retried", "job", result);
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
        onSuccess(removed) {
          bulkResultToast("removed", "job", {
            succeeded: removed.length,
            failed: 0,
          });
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
            bulkResultToast("removed", "job", result);
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
            bulkResultToast("promoted", "job", result);
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
          bulkResultToast("retried", "job", result);
        },
      }),
    );

  const cleanSupport = queue?.supports.clean;
  const canCleanStatus =
    status !== "waiting-children" &&
    (cleanSupport === true ||
      (typeof cleanSupport === "object" &&
        cleanSupport.supportedStatuses.includes(status)));
  const hasFilter = Boolean(query || selectedGroupId);
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
  const showPromoteAll =
    totalJobs > 0 &&
    status === "delayed" &&
    !!queue?.supports.promote &&
    queue.access.actions["job.promote"];

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
    hasFilter,
    status,
    total: totalJobs,
  });
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
  const hasReachedEnd = !isEmpty && jobs.length >= totalJobs;
  const knownCount = queue ? (queue.counts[status] ?? 0) : null;
  // Without queue metadata there is no count to gate on yet, and skipping the
  // skeleton here is what used to flash "No jobs found" on every cold load.
  const showSkeleton = isLoading && (knownCount === null || knownCount > 0);

  useEffect(() => {
    setRowSelection({});
    setOwnedJobId(null);
    lastClickedJobIdRef.current = null;
  }, [query, queueName, selectedGroupId, status]);

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
      if (event.key !== "Escape") return;
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
    bulkResultToast("rerun", "job", {
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
        />
      ) : null}
      {showAddJobModal && queue ? (
        <AddJobModal
          queue={queue}
          variant="job"
          onDismiss={() => setShowAddJobModal(false)}
        />
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
            />
          ) : undefined
        }
        header={table.getHeaderGroups().map((headerGroup) => (
          <div
            role="row"
            className={clsx(
              "grid px-2",
              getTableGridClassName("job", canSelectRows),
              getTableMinWidthClassName("job"),
              getTableHeaderPaddingClassName(preferences.density),
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
          </div>
        ))}
        footer={
          isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-1 px-6 py-12 text-center">
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {hasFilter ? "No matching jobs" : emptyStateCopy.title}
              </p>
              <p className={clsx("max-w-sm text-sm", TEXT_MUTED)}>
                {hasFilter
                  ? `Nothing in the ${statusLabel} list matches the current search or group filter.`
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
            // A capped search cannot promise there is nothing further, and
            // the footer directly below says "At least N" - so the terminus
            // has to stop claiming otherwise.
            <p className={clsx("py-4 text-center text-xs", TEXT_MUTED)}>
              {searchIsPartial
                ? "End of the results scanned so far"
                : "End of list"}
            </p>
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
                )}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </div>
            ))}
          </TableRow>
        ))}
      </TableFrame>

      {/* The footer is always present, so a read-only user still gets a count
          and a terminus - it used to render only alongside bulk actions. */}
      <div
        className={clsx(
          FLOATING_BAR_DOCK,
          // Below the sticky header, which must win when a row scrolls past it.
          "z-[5]",
          showSkeleton && "invisible",
        )}
      >
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-gray-200/60 bg-white/90 px-3 py-1.5 text-xs shadow-md backdrop-blur sm:rounded-full dark:border-slate-700/60 dark:bg-slate-900/90">
          {/* `tabular-nums` so the count does not shift the bar's width on
              every poll. */}
          <p
            className={clsx(
              "tabular-nums",
              hasSelection ? "text-gray-900 dark:text-slate-100" : TEXT_MUTED,
            )}
          >
            {footerLabel}
            {/* What the count was built from. Only worth saying when a filter
                narrowed the scan, or when the server's cap cut it short. */}
            {!hasSelection &&
            scannedCount !== undefined &&
            (hasFilter || searchIsPartial) ? (
              <span
                className={
                  searchIsPartial
                    ? "text-amber-600 dark:text-amber-400"
                    : TEXT_FAINT
                }
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
                  . This list stops updating once more than one page is loaded;
                  press to reset to the first page.
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
                size="sm"
                onClick={() => table.resetRowSelection()}
              />

              {canRetrySelection || canRerunSelection ? (
                <Button
                  label={canRetrySelection ? "Retry" : "Rerun"}
                  icon={<RotateCw className="size-3.5" />}
                  size="sm"
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
                  title="Remove selected jobs?"
                  description={`This action cannot be undone. This will permanently remove ${formatCountLabel(
                    selectedCount,
                    "job",
                  )} from the queue.`}
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
                    size="sm"
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
                  title={
                    hasFilter
                      ? "Retry matching failed jobs?"
                      : "Retry eligible failed jobs?"
                  }
                  description="This will retry eligible failed jobs found within the server scan limit and move them back to the waiting state."
                  action={
                    <Button
                      variant="filled"
                      colorScheme="brand"
                      label={
                        hasFilter ? "Yes, retry matches" : "Yes, retry eligible"
                      }
                      onClick={() =>
                        bulkRetry({
                          queueName,
                          status: "failed",
                          groupId: selectedGroupId ?? undefined,
                          query,
                        })
                      }
                    />
                  }
                >
                  <Button
                    as="span"
                    icon={<RotateCw className="size-3.5" />}
                    label={hasFilter ? "Retry matches" : "Retry eligible"}
                    size="sm"
                    isLoading={bulkRetryStatus === "pending"}
                  />
                </Alert>
              ) : null}
              {showPromoteAll ? (
                <Alert
                  isPending={bulkPromoteStatus === "pending"}
                  title={
                    hasFilter
                      ? "Promote matching delayed jobs?"
                      : "Promote eligible delayed jobs?"
                  }
                  description="This will promote eligible delayed jobs found within the server scan limit into the runnable queue."
                  action={
                    <Button
                      variant="filled"
                      colorScheme="slate"
                      label="Yes, promote"
                      onClick={() =>
                        bulkPromote({
                          queueName,
                          status: "delayed",
                          groupId: selectedGroupId ?? undefined,
                          query,
                        })
                      }
                    />
                  }
                >
                  <Button
                    as="span"
                    icon={<Rocket className="size-3.5" />}
                    label={hasFilter ? "Promote matches" : "Promote eligible"}
                    size="sm"
                    isLoading={bulkPromoteStatus === "pending"}
                  />
                </Alert>
              ) : null}
              {showCleanAll ? (
                <Alert
                  isPending={cleanQueueStatus === "pending"}
                  title={`Remove all ${statusLabel} jobs?`}
                  description={`This action cannot be undone. This will permanently remove all ${statusLabel} jobs from the queue.`}
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
                    label={`Remove all ${statusLabel}`}
                    size="sm"
                    isLoading={cleanQueueStatus === "pending"}
                  />
                </Alert>
              ) : null}
              {showRemoveAll ? (
                <Alert
                  isPending={bulkRemoveByFilterStatus === "pending"}
                  title={
                    hasFilter
                      ? "Remove matching jobs?"
                      : `Remove eligible ${statusLabel} jobs?`
                  }
                  description="This action cannot be undone. It will remove eligible jobs found within the server scan limit."
                  action={
                    <Button
                      variant="filled"
                      colorScheme="red"
                      label="Yes, remove jobs"
                      onClick={() =>
                        bulkRemoveByFilter({
                          queueName,
                          status,
                          groupId: selectedGroupId ?? undefined,
                          query,
                        })
                      }
                    />
                  }
                >
                  <Button
                    as="span"
                    icon={<Trash2 className="size-3.5" />}
                    label={hasFilter ? "Remove matches" : "Remove eligible"}
                    size="sm"
                    isLoading={bulkRemoveByFilterStatus === "pending"}
                  />
                </Alert>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
