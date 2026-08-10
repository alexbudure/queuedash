import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowRight,
  Bug,
  Check,
  Clock,
  Loader2,
  PlusCircle,
  Rocket,
  RotateCcw,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useInView } from "react-intersection-observer";
import { toast } from "sonner";

import type { Job, RouterOutput, Status } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { JobModal } from "./JobModal";
import { JobTableSkeleton } from "./JobTableSkeleton";
import { useQueuedash } from "./QueuedashProvider";
import { TableRow } from "./TableRow";
import { Timestamp } from "./Timestamp";
import { Tooltip } from "./Tooltip";

const formatDuration = (ms: number | null | undefined): string => {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(2)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(2)}h`;
  return `${(hours / 24).toFixed(2)}d`;
};

const HorizontalDividerDots = () => {
  return (
    <div className="flex items-center gap-0.5">
      <div className="size-0.5 rounded-full bg-gray-300 dark:bg-slate-600" />
      <div className="size-0.5 rounded-full bg-gray-400 dark:bg-slate-500" />
      <div className="size-0.5 rounded-full bg-gray-300 dark:bg-slate-600" />
    </div>
  );
};

const lifecycleDateLabelClassName =
  "inline-block w-[7.5rem] whitespace-nowrap text-xs tabular-nums text-gray-500 transition-colors group-hover/tooltip:text-gray-700 dark:text-slate-400 dark:group-hover/tooltip:text-slate-300";

const lifecycleTimeLabelClassName =
  "inline-block w-[4.75rem] whitespace-nowrap text-xs tabular-nums text-gray-500 transition-colors group-hover/tooltip:text-gray-700 dark:text-slate-400 dark:group-hover/tooltip:text-slate-300";

const columnHelper = createColumnHelper<Job & { status: Status }>();

const columns = [
  columnHelper.display({
    id: "select",
    header: ({ table }) => (
      <Checkbox
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
    cell: ({ row, table }) => (
      <Checkbox
        className={
          table.getIsSomeRowsSelected() || table.getIsAllRowsSelected()
            ? ""
            : "opacity-0 transition group-hover:opacity-100"
        }
        {...{
          checked: row.getIsSomeSelected()
            ? "indeterminate"
            : row.getIsSelected(),
          onCheckedChange: row.getToggleSelectedHandler(),
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
          <div className="flex min-w-0 items-center gap-3 py-1 pr-6">
            <span className="max-w-[80%] shrink-0 truncate font-mono text-sm text-gray-900 dark:text-white">
              {hasName ? job.name : job.id}
            </span>
            {hasName ? (
              <span className="truncate rounded-full bg-gray-50 px-1.5 font-mono text-[10px] text-gray-400 dark:bg-gray-950 dark:text-slate-500">
                #{job.id}
              </span>
            ) : null}
          </div>
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
        <div className="flex min-w-0 items-center gap-10 font-mono">
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
                <PlusCircle className="size-3 shrink-0 text-gray-400 dark:text-slate-500" />
              )}
              <span className={lifecycleDateLabelClassName}>
                <Timestamp value={job.retriedAt || job.createdAt} />
              </span>
            </span>
          </Tooltip>

          <HorizontalDividerDots />

          {/* State-specific content */}
          {isWaitingState ? (
            <Tooltip content="Waiting to be processed">
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="inline-flex h-5 w-16 items-center justify-between space-x-1 rounded-full bg-amber-50 px-1.5 dark:bg-amber-950/50">
                  <span className="w-14 text-[10px] text-amber-700 dark:text-amber-400">
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
                  <span className="inline-flex h-5 w-16 items-center justify-between space-x-1 rounded-full bg-gray-50 px-1.5 transition-colors group-hover/tooltip:bg-gray-100 dark:bg-slate-800 dark:group-hover/tooltip:bg-slate-700">
                    <span className="text-[10px] text-gray-600 dark:text-slate-300">
                      {formatDuration(processed.getTime() - added.getTime())}
                    </span>
                    <ArrowRight className="size-3 text-gray-400 dark:text-slate-500" />
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

              <HorizontalDividerDots />
              <Tooltip
                content={
                  <>
                    Processing for{" "}
                    {formatDuration(Date.now() - processed.getTime())}
                  </>
                }
              >
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="inline-flex h-5 w-16 items-center justify-between space-x-1 rounded-full bg-blue-50 px-1.5 dark:bg-blue-950/50">
                    <span className="w-14 text-[10px] text-blue-700 dark:text-blue-400">
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
                  <span className="inline-flex h-5 w-16 items-center justify-between space-x-1 rounded-full bg-gray-50 px-1.5 transition-colors group-hover/tooltip:bg-gray-100 dark:bg-slate-800 dark:group-hover/tooltip:bg-slate-700">
                    <span className="text-[10px] text-gray-600 dark:text-slate-300">
                      {formatDuration(processed.getTime() - added.getTime())}
                    </span>
                    <ArrowRight className="size-3 text-gray-400 dark:text-slate-500" />
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

              <HorizontalDividerDots />
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
                    className={`inline-flex h-5 w-16 items-center justify-between space-x-1 rounded-full px-1.5 transition-colors ${
                      failed
                        ? "bg-red-50 group-hover/tooltip:bg-red-100 dark:bg-red-950/50 dark:group-hover/tooltip:bg-red-950/70"
                        : "bg-green-50 group-hover/tooltip:bg-green-100 dark:bg-green-950/50 dark:group-hover/tooltip:bg-green-950/70"
                    }`}
                  >
                    <span
                      className={`text-[10px] ${
                        failed
                          ? "text-red-700 dark:text-red-400"
                          : "text-green-700 dark:text-green-400"
                      }`}
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
                <span className="text-[10px] whitespace-nowrap text-gray-400 dark:text-slate-500">
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
            <span className="rounded-full bg-purple-50 p-1 transition-colors group-hover/tooltip:bg-purple-100 dark:bg-purple-950/40 dark:group-hover/tooltip:bg-purple-950/60">
              <RotateCw className="size-3 text-purple-500 dark:text-purple-400" />
            </span>
          </Tooltip>
        ) : null}
        {job.stacktrace && job.stacktrace.length > 0 ? (
          <Tooltip content="Has stack trace">
            <span className="p-1">
              <Bug className="size-3.5 text-red-500 dark:text-red-400" />
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
}: JobTableProps) => {
  const { preferences } = useQueuedash();
  const [rowSelection, setRowSelection] = useState({});
  const { ref } = useInView({
    threshold: 0,
    onChange(inView) {
      if (inView) {
        onBottomInView();
      }
    },
  });
  const table = useReactTable({
    data: jobs,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: {
      rowSelection,
    },
    onRowSelectionChange: setRowSelection,
  });
  const isEmpty = jobs.length === 0;
  const [selectedJob, setSelectedJob] = useState<
    (Job & { status: Status }) | null
  >(null);

  const { mutate: retry } = trpc.job.retry.useMutation();
  const { mutate: rerun } = trpc.job.rerun.useMutation();
  const { mutate: bulkRemove } = trpc.job.bulkRemove.useMutation();

  const { mutate: bulkRemoveByFilter, status: bulkRemoveByFilterStatus } =
    trpc.job.bulkRemoveByFilter.useMutation({
      onSuccess(data) {
        toast.success(
          `Removed ${data.succeeded} job${data.succeeded !== 1 ? "s" : ""}${
            data.failed > 0 ? `, ${data.failed} failed` : ""
          }${data.partial ? "; more jobs may match" : ""}`,
        );
      },
      onError(error) {
        toast.error(error.message || "Failed to remove jobs");
      },
    });

  const { mutate: bulkPromote, status: bulkPromoteStatus } =
    trpc.job.bulkPromoteByFilter.useMutation({
      onSuccess(data) {
        toast.success(
          `Promoted ${data.succeeded} job${data.succeeded !== 1 ? "s" : ""}${
            data.failed > 0 ? `, ${data.failed} failed` : ""
          }${data.partial ? "; more jobs may match" : ""}`,
        );
      },
      onError(error) {
        toast.error(error.message || "Failed to promote jobs");
      },
    });

  const { mutate: cleanQueue, status: cleanQueueStatus } =
    trpc.queue.clean.useMutation({
      onSuccess() {
        toast.success(`All ${status} jobs have been removed`);
      },
    });

  const { mutate: bulkRetry, status: bulkRetryStatus } =
    trpc.job.bulkRetryByFilter.useMutation({
      onSuccess(data) {
        toast.success(
          `Retried ${data.succeeded} job${data.succeeded !== 1 ? "s" : ""}${data.failed > 0 ? `, ${data.failed} failed` : ""}${data.partial ? "; more jobs may match" : ""}`,
        );
      },
      onError(error) {
        toast.error(error.message || "Failed to retry jobs");
      },
    });

  const cleanSupport = queue?.supports.clean;
  const canCleanStatus =
    status !== "waiting-children" &&
    (cleanSupport === true ||
      (typeof cleanSupport === "object" &&
        cleanSupport.supportedStatuses.includes(status)));
  const hasFilter = Boolean(query || selectedGroupId);
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
  const hasStatusActions =
    showCleanAll || showRemoveAll || showRetryAll || showPromoteAll;

  useEffect(() => {
    setRowSelection({});
    setSelectedJob(null);
  }, [query, queueName, selectedGroupId, status]);

  return (
    <div>
      {selectedJob ? (
        <JobModal
          queueName={queueName}
          job={selectedJob}
          status={selectedJob.status}
          onDismiss={() => setSelectedJob(null)}
        />
      ) : null}
      <div className="mb-4 overflow-x-auto rounded-xl border border-gray-100/60 dark:border-slate-800/60">
        {isLoading && (queue?.counts[status] ?? 0) > 0 ? (
          <JobTableSkeleton rows={preferences.jobsPerPage} />
        ) : (
          <div className="min-w-max">
            {table.getHeaderGroups().map((headerGroup) => (
              <div
                className={`sticky top-0 z-10 grid grid-cols-[36px_minmax(200px,35%)_minmax(auto,1fr)_100px] border-b border-gray-100/60 bg-gray-50/80 px-2 backdrop-blur dark:border-slate-800/60 dark:bg-slate-900/80 ${
                  preferences.density === "compact" ? "py-1" : "py-2"
                }`}
                key={headerGroup.id}
              >
                {headerGroup.headers.map((header) => (
                  <div
                    key={header.id}
                    className="flex h-full items-center px-1.5 text-xs font-medium text-gray-400 dark:text-slate-500"
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
            {table.getRowModel().rows.map((row, rowIndex) => (
              <TableRow
                isLastRow={table.getRowModel().rows.length !== rowIndex + 1}
                key={row.id}
                isSelected={row.getIsSelected()}
                onClick={() => setSelectedJob(row.original)}
                onKeyboardActivate={() => setSelectedJob(row.original)}
                layoutVariant="job"
              >
                {row.getVisibleCells().map((cell) => (
                  <div
                    key={cell.id}
                    className="flex h-full items-center px-1.5"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </TableRow>
            ))}
            {!isLoading && isEmpty ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  {hasFilter ? "No jobs match this filter" : "No jobs found"}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </div>
      {!isLoading && !isEmpty && jobs.length < totalJobs ? (
        <div ref={ref} className="flex items-center justify-center py-4">
          {isFetchingNextPage ? (
            <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-slate-500">
              <Loader2 className="size-3.5 animate-spin" />
              <span>Loading more...</span>
            </div>
          ) : (
            <div className="h-4" />
          )}
        </div>
      ) : null}

      {table.getSelectedRowModel().rows.length > 0 ? (
        <div className="pointer-events-none sticky bottom-0 flex w-full items-center justify-center pb-5">
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-gray-200/60 bg-white/90 px-3 py-1.5 text-xs shadow-md backdrop-blur sm:rounded-full dark:border-slate-700/60 dark:bg-slate-900/90">
            <p className="text-gray-900 dark:text-slate-100">
              {table.getSelectedRowModel().rows.length} selected
            </p>
            {(status === "completed" && queue?.access.actions["job.rerun"]) ||
            (status === "failed" && queue?.access.actions["job.retry"]) ? (
              <Button
                label={status === "failed" ? "Retry" : "Rerun"}
                icon={<RotateCw className="size-3.5" />}
                size="sm"
                onClick={() => {
                  table.getSelectedRowModel().rows.forEach((row) => {
                    if (status === "failed") {
                      retry({
                        queueName,
                        jobId: row.original.id,
                      });
                    } else {
                      rerun({
                        queueName,
                        jobId: row.original.id,
                      });
                    }
                  });
                  table.resetRowSelection();
                }}
              />
            ) : null}

            {queue?.access.actions["job.remove"] ? (
              <Button
                label="Delete"
                colorScheme="red"
                icon={<Trash2 className="size-3.5" />}
                size="sm"
                onClick={() => {
                  bulkRemove({
                    queueName,
                    jobIds: table
                      .getSelectedRowModel()
                      .rows.map((row) => row.original.id),
                  });
                  table.resetRowSelection();
                }}
              />
            ) : null}
          </div>
        </div>
      ) : hasStatusActions ? (
        <div className="pointer-events-none sticky bottom-0 flex w-full items-center justify-center pb-5">
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-gray-200/60 bg-white/90 px-3 py-1.5 text-xs shadow-md backdrop-blur sm:rounded-full dark:border-slate-700/60 dark:bg-slate-900/90">
            <p className="text-gray-500 dark:text-slate-400">
              {totalJobs} {status} job{totalJobs !== 1 ? "s" : ""}
            </p>
            {showRetryAll ? (
              <Alert
                title={
                  hasFilter
                    ? "Retry matching failed jobs?"
                    : "Retry all failed jobs?"
                }
                description={`This will retry ${totalJobs} failed job${totalJobs !== 1 ? "s" : ""} and move them back to the waiting state.${searchIsPartial ? " More jobs may match beyond the server scan limit." : ""}`}
                action={
                  <Button
                    variant="filled"
                    colorScheme="slate"
                    label={hasFilter ? "Yes, retry matches" : "Yes, retry all"}
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
                  label={hasFilter ? "Retry matches" : "Retry all"}
                  size="sm"
                  isLoading={bulkRetryStatus === "pending"}
                />
              </Alert>
            ) : null}
            {showPromoteAll ? (
              <Alert
                title={
                  hasFilter
                    ? "Promote matching delayed jobs?"
                    : "Promote all delayed jobs?"
                }
                description={`This will promote ${totalJobs} delayed job${totalJobs !== 1 ? "s" : ""} into the runnable queue.${searchIsPartial ? " Only the bounded results currently shown will be affected." : ""}`}
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
                  label={hasFilter ? "Promote matches" : "Promote all"}
                  size="sm"
                  isLoading={bulkPromoteStatus === "pending"}
                />
              </Alert>
            ) : null}
            {showCleanAll ? (
              <Alert
                title="Are you absolutely sure?"
                description={`This action cannot be undone. This will permanently remove all ${status} jobs from the queue.`}
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
                  colorScheme="red"
                  icon={<Trash2 className="size-3.5" />}
                  label="Clean all"
                  size="sm"
                  isLoading={cleanQueueStatus === "pending"}
                />
              </Alert>
            ) : null}
            {showRemoveAll ? (
              <Alert
                title={
                  hasFilter
                    ? "Remove matching jobs?"
                    : `Remove all ${status} jobs?`
                }
                description={`This action cannot be undone. It will remove ${totalJobs} job${totalJobs !== 1 ? "s" : ""} through the bounded filter pipeline.${searchIsPartial ? " More jobs may match beyond the server scan limit." : ""}`}
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
                  colorScheme="red"
                  icon={<Trash2 className="size-3.5" />}
                  label={hasFilter ? "Remove matches" : "Remove all"}
                  size="sm"
                  isLoading={bulkRemoveByFilterStatus === "pending"}
                />
              </Alert>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};
