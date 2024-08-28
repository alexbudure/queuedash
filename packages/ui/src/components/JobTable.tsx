import { useEffect, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  CheckCircledIcon,
  ClockIcon,
  CounterClockwiseClockIcon,
  CrossCircledIcon,
  DotsHorizontalIcon,
  PlusCircledIcon,
  SlashIcon,
  LapTimerIcon,
  ExclamationTriangleIcon,
  TargetIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { format, formatDistanceStrict, formatDistanceToNow } from "date-fns";
import type { Job, Status } from "../utils/trpc";
import { useInView } from "react-intersection-observer";
import { JobTableRow } from "./JobTableRow";
import { JobTableSkeleton } from "./JobTableSkeleton";
import { Checkbox } from "./Checkbox";
import { JobOptionTag } from "./JobOptionTag";
import * as Progress from "@radix-ui/react-progress";
import { Tooltip } from "./Tooltip";
import { JobModal } from "./JobModal";
import { Button } from "./Button";
import { trpc } from "../utils/trpc";

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
    cell: (props) => (
      <div className="flex w-full items-center space-x-2">
        <span className="max-w-fit grow basis-full truncate text-slate-900 dark:text-slate-200">
          {props.cell.row.original.name}
        </span>

        <span className="shrink truncate max-w-[20%] text-sm text-slate-500 dark:text-slate-400">
          #{props.cell.row.original.id}
        </span>
      </div>
    ),
    header: "Name",
  }),

  columnHelper.display({
    id: "lifecycle",
    header: () => "Lifecycle",
    cell: ({
      row: {
        original: { createdAt, processedAt, finishedAt, status, retriedAt },
      },
    }) => {
      return (
        <div className="flex items-center space-x-3">
          <LifecycleItem date={new Date(createdAt)} variant="added" />
          {status === "waiting" ? <LoadingIntervalDivider /> : null}

          {processedAt ? (
            <>
              <TimeIntervalDivider
                date={new Date(processedAt)}
                baseDate={new Date(createdAt)}
              />
              <LifecycleItem
                date={new Date(processedAt)}
                variant={retriedAt ? "retried" : "processing"}
              />
            </>
          ) : null}
          {status === "active" ? <LoadingIntervalDivider /> : null}

          {finishedAt && processedAt ? (
            <>
              <TimeIntervalDivider
                date={new Date(finishedAt)}
                baseDate={new Date(processedAt)}
              />
              <LifecycleItem
                date={new Date(finishedAt)}
                variant={status === "failed" ? "failed" : "completed"}
              />
            </>
          ) : null}
        </div>
      );
    },
  }),
  columnHelper.display({
    id: "options",
    header: "Options",
    cell: ({
      row: {
        original: { opts },
      },
    }) => {
      return (
        <div className="flex items-center space-x-2">
          {opts.priority ? (
            <JobOptionTag
              icon={<ExclamationTriangleIcon width={12} height={12} />}
              label={opts.priority}
            />
          ) : null}
          {opts.attempts && opts.attempts > 1 ? (
            <JobOptionTag
              icon={<CounterClockwiseClockIcon width={12} height={12} />}
              label={opts.attempts}
            />
          ) : null}
          {opts.lifo ? (
            <JobOptionTag
              icon={<TargetIcon width={12} height={12} />}
              label="LIFO"
            />
          ) : null}
          {opts.delay ? (
            <JobOptionTag
              icon={<LapTimerIcon width={12} height={12} />}
              label={opts.delay}
            />
          ) : null}
        </div>
      );
    },
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
};
export const JobTable = ({
  jobs,
  totalJobs,
  onBottomInView,
  isLoading,
  isFetchingNextPage,
  queueName,
  status,
}: JobTableProps) => {
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
  const progress = (jobs.length / (totalJobs || 0)) * 100;
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const { mutate: retry } = trpc.job.retry.useMutation();
  const { mutate: rerun } = trpc.job.rerun.useMutation();
  const { mutate: bulkRemove } = trpc.job.bulkRemove.useMutation();

  useEffect(() => {
    table.resetRowSelection();
  }, [status]);

  return (
    <div>
      {selectedJob ? (
        <JobModal
          queueName={queueName}
          job={selectedJob}
          onDismiss={() => setSelectedJob(null)}
        />
      ) : null}
      <div className="rounded-md border border-slate-200 shadow-sm dark:border-slate-700">
        {isLoading ? (
          <JobTableSkeleton />
        ) : (
          <div>
            {table.getHeaderGroups().map((headerGroup, headerIndex) => (
              <div
                className="sticky top-0 grid grid-cols-[auto,350px,576px,1fr] rounded-t-md border-b border-slate-200 bg-slate-100/50 p-2 backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/50"
                key={headerGroup.id}
              >
                {headerGroup.headers.map((header) => (
                  <div
                    key={header.id}
                    className={`flex h-full items-center text-sm font-semibold text-slate-700 dark:text-slate-300  ${
                      headerIndex !== 0 ? "pr-10" : "pr-3"
                    }`}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </div>
                ))}
              </div>
            ))}
            {table.getRowModel().rows.map((row, rowIndex) => (
              <JobTableRow
                isLastRow={table.getRowModel().rows.length !== rowIndex + 1}
                key={row.id}
                isSelected={row.getIsSelected()}
                onClick={() => setSelectedJob(row.original)}
              >
                {row.getVisibleCells().map((cell, cellIndex) => (
                  <div
                    key={cell.id}
                    className={`flex h-full items-center ${
                      cellIndex !== 0 ? "pr-10" : "pr-3"
                    }`}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </JobTableRow>
            ))}
            {!isLoading && isEmpty ? (
              <div className="flex items-center justify-center py-10">
                <p className="text-slate-500">No jobs found</p>
              </div>
            ) : null}
          </div>
        )}
      </div>
      {!isLoading && isEmpty ? null : (
        <div ref={ref} className="my-3 flex justify-center">
          <div className="flex flex-col items-center space-y-2">
            <p className="text-xs text-slate-500">
              You&apos;ve viewed {jobs.length} of {totalJobs} jobs
            </p>

            <Progress.Root
              className="relative h-0.5 w-[144px] overflow-hidden rounded-sm bg-slate-200"
              value={progress}
              style={{
                transform: "translateZ(0)",
              }}
            >
              <Progress.Indicator
                className="h-full w-full bg-cyan-500 transition duration-300 ease-in-out"
                style={{ transform: `translateX(-${100 - progress}%)` }}
              />
            </Progress.Root>

            {isFetchingNextPage ? (
              <SlashIcon className="animate-spin text-slate-300" />
            ) : null}
          </div>
        </div>
      )}

      {table.getSelectedRowModel().rows.length > 0 ? (
        <div className="pointer-events-none sticky bottom-0 flex w-full items-center justify-center pb-5">
          <div className="pointer-events-auto flex items-center space-x-3 rounded-lg border-slate-100 bg-white/90 py-2 px-3 text-sm shadow-lg backdrop-blur">
            <p>{table.getSelectedRowModel().rows.length} selected</p>
            {status === "completed" || status === "failed" ? (
              <Button
                label={status === "failed" ? "Retry" : "Rerun"}
                icon={<CounterClockwiseClockIcon />}
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

            <Button
              label="Delete"
              colorScheme="red"
              icon={<TrashIcon />}
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
          </div>
        </div>
      ) : null}
    </div>
  );
};

type LifecycleItemProps = {
  date: Date;
  variant: "added" | "completed" | "failed" | "processing" | "retried";
};

const LifecycleItem = ({ variant, date }: LifecycleItemProps) => {
  const variantToPrefixMap: Record<LifecycleItemProps["variant"], string> = {
    added: "Added to queue",
    completed: "Completed",
    failed: "Failed",
    processing: "Processed",
    retried: "Retried",
  };

  return (
    <Tooltip
      message={`${variantToPrefixMap[variant]} ${formatDistanceToNow(
        date
      )} ago`}
    >
      <div className="flex items-center space-x-1.5">
        {variant === "added" && (
          <PlusCircledIcon
            width={14}
            height={14}
            className="rounded-full bg-cyan-50 text-cyan-900"
          />
        )}
        {variant === "processing" && (
          <ClockIcon
            width={14}
            height={14}
            className="rounded-full bg-slate-50 text-slate-900"
          />
        )}
        {variant === "retried" && (
          <CounterClockwiseClockIcon
            width={14}
            height={14}
            className="rounded-full bg-amber-50 text-amber-900"
          />
        )}
        {variant === "completed" && (
          <CheckCircledIcon
            width={14}
            height={14}
            className="rounded-full bg-green-50 text-green-900"
          />
        )}
        {variant === "failed" && (
          <CrossCircledIcon
            width={14}
            height={14}
            className="rounded-full bg-red-50 text-red-900"
          />
        )}

        <p className="text-slate-900 dark:text-slate-200">
          {format(date, `${variant === "added" ? "MM/dd " : ""}HH:mm:ss`)}
        </p>
      </div>
    </Tooltip>
  );
};

const LoadingIntervalDivider = () => {
  return (
    <div className="flex items-center space-x-1.5">
      <DotsHorizontalIcon width={14} height={14} className="text-slate-300" />
      <SlashIcon
        width={14}
        height={14}
        className="animate-spin text-slate-300 dark:text-slate-600"
      />
    </div>
  );
};

type TimeIntervalDividerProps = {
  date: Date;
  baseDate: Date;
};

const TimeIntervalDivider = ({ date, baseDate }: TimeIntervalDividerProps) => {
  return (
    <div className="flex items-center space-x-1.5">
      <DotsHorizontalIcon width={14} height={14} className="text-slate-300" />

      <p className="w-7 rounded-sm text-center text-xs text-slate-500 dark:text-slate-400">
        {formatDistanceStrict(date, baseDate, {
          locale: {
            formatDistance: (token, count) => {
              if (token === "xSeconds") {
                return `${count}s`;
              } else if (token === "xMinutes") {
                return `${count}m`;
              } else if (token === "xHours") {
                return `${count}h`;
              } else if (token === "xDays") {
                return `${count}d`;
              } else if (token === "xMonths") {
                return `${count}mo`;
              } else if (token === "xYears") {
                return `${count}y`;
              } else {
                return "";
              }
            },
          },
        })}
      </p>

      <DotsHorizontalIcon
        width={14}
        height={14}
        className="text-slate-300 dark:text-slate-600"
      />
    </div>
  );
};
