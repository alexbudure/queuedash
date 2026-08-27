import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import cronstrue from "cronstrue";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { NUM_OF_RETRIES } from "../utils/config";
import type { Queue, Scheduler } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import {
  getRowRangeSelection,
  getSchedulerRowAriaLabel,
  getSchedulerRowId,
  getSchedulerSelectionAriaLabel,
  getTableGridClassName,
} from "../utils/viewState";
import { Button } from "./Button";
import { Checkbox, ROW_SELECTION_CHECKBOX_CLASS_NAME } from "./Checkbox";
import { ErrorCard } from "./ErrorCard";
import { JobTableSkeleton } from "./JobTableSkeleton";
import { useQueuedash } from "./QueuedashProvider";
import { SchedulerModal } from "./SchedulerModal";
import { TableRow } from "./TableRow";
import { formatAbsoluteTimestamp, Timestamp } from "./Timestamp";
import { Tooltip } from "./Tooltip";

const columnHelper = createColumnHelper<Scheduler>();

function getTimezoneAbbreviation(timeZone: string, date: Date = new Date()) {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    });

    const parts = formatter.formatToParts(date);
    const tzPart = parts.find((part) => part.type === "timeZoneName");
    return tzPart?.value || timeZone;
  } catch {
    return timeZone;
  }
}

const describeCronPattern = (pattern: string): string => {
  try {
    return cronstrue.toString(pattern, { verbose: true });
  } catch {
    return pattern;
  }
};

const createColumns = (onCheckboxClick: (schedulerKey: string) => void) => [
  columnHelper.display({
    id: "select",
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all schedulers"
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
        aria-label={getSchedulerSelectionAriaLabel(row.original)}
        className={
          table.getIsSomeRowsSelected() || table.getIsAllRowsSelected()
            ? ""
            : ROW_SELECTION_CHECKBOX_CLASS_NAME
        }
        {...{
          checked: row.getIsSomeSelected()
            ? "indeterminate"
            : row.getIsSelected(),
          onCheckedChange: (checked) => {
            row.getToggleSelectedHandler()(checked);
            onCheckboxClick(row.original.key);
          },
        }}
      />
    ),
  }),
  columnHelper.accessor("name", {
    cell: (props) => (
      <div className="flex min-w-0 items-center py-1">
        <span className="truncate font-mono text-sm text-gray-900 dark:text-white">
          {props.cell.row.original.name}
        </span>
      </div>
    ),
    header: "Scheduler",
  }),
  columnHelper.accessor("pattern", {
    cell: (props) => {
      const scheduler = props.cell.row.original;
      const patternDescription = scheduler.pattern
        ? describeCronPattern(scheduler.pattern)
        : scheduler.every
          ? `Every ${scheduler.every}`
          : "";
      const patternLabel = `${patternDescription}${
        scheduler.tz
          ? ` (${getTimezoneAbbreviation(
              scheduler.tz,
              scheduler.next ? new Date(scheduler.next) : new Date(),
            )})`
          : ""
      }`;

      return (
        <p
          className="min-w-0 truncate py-1 text-sm text-gray-500 dark:text-slate-400"
          title={patternLabel}
        >
          {patternLabel}
        </p>
      );
    },
    header: "Pattern",
  }),
  columnHelper.accessor("next", {
    cell: (props) => {
      if (!props.cell.row.original.next) {
        return (
          <p className="py-1 text-sm text-gray-500 dark:text-slate-400">
            No next run
          </p>
        );
      }
      return (
        <Tooltip
          content={formatAbsoluteTimestamp(
            props.cell.row.original.next,
            "full",
          )}
          triggerClassName="w-full justify-start"
        >
          <span className="flex w-full min-w-0 items-center space-x-1.5 py-1">
            <span className="truncate text-sm text-gray-900 dark:text-white">
              <Timestamp value={props.cell.row.original.next} variant="full" />{" "}
              <span className="text-xs text-gray-400 dark:text-slate-500">
                ({props.cell.row.original.iterationCount} run
                {props.cell.row.original.iterationCount === 1 ? "" : "s"} total)
              </span>
            </span>
          </span>
        </Tooltip>
      );
    },
    header: "Next Run",
  }),
];

type SchedulerTableProps = {
  canRemove: boolean;
  queue?: Queue;
  queueName: string;
};
export const SchedulerTable = ({
  canRemove,
  queue,
  queueName,
}: SchedulerTableProps) => {
  const { preferences } = useQueuedash();
  const [rowSelection, setRowSelection] = useState({});
  const lastClickedSchedulerKeyRef = useRef<string | null>(null);
  const { data, isError, isLoading } = trpc.scheduler.list.useQuery(
    {
      queueName,
    },
    {
      enabled: queue?.supports.schedulers === true,
      refetchInterval: preferences.refreshIntervalMs,
      retry: NUM_OF_RETRIES,
    },
  );

  const isEmpty = data?.length === 0;

  const handleCheckboxClick = (schedulerKey: string) => {
    lastClickedSchedulerKeyRef.current = schedulerKey;
  };

  const schedulerColumns = createColumns(handleCheckboxClick);
  const columns = canRemove ? schedulerColumns : schedulerColumns.slice(1);

  const table = useReactTable({
    data: data || [],
    columns,
    enableRowSelection: canRemove,
    getRowId: getSchedulerRowId,
    getCoreRowModel: getCoreRowModel(),
    state: {
      rowSelection,
    },
    onRowSelectionChange: setRowSelection,
  });

  const [selectedScheduler, setSelectedScheduler] = useState<Scheduler | null>(
    null,
  );

  useEffect(() => {
    setRowSelection({});
    setSelectedScheduler(null);
    lastClickedSchedulerKeyRef.current = null;
  }, [queueName]);

  useEffect(() => {
    if (!canRemove) {
      setRowSelection({});
      lastClickedSchedulerKeyRef.current = null;
    }
  }, [canRemove]);

  useEffect(() => {
    if (
      selectedScheduler &&
      data &&
      !data.some((scheduler) => scheduler.key === selectedScheduler.key)
    ) {
      setSelectedScheduler(null);
    }
    if (
      data &&
      lastClickedSchedulerKeyRef.current &&
      !data.some(
        (scheduler) => scheduler.key === lastClickedSchedulerKeyRef.current,
      )
    ) {
      lastClickedSchedulerKeyRef.current = null;
    }
  }, [data, selectedScheduler]);

  const { mutate: bulkRemove } = trpc.scheduler.bulkRemove.useMutation();

  const handleRowClick = (
    e: React.MouseEvent<HTMLDivElement>,
    rowIndex: number,
  ) => {
    const rows = table.getRowModel().rows;
    const anchorIndex = rows.findIndex(
      (row) => row.original.key === lastClickedSchedulerKeyRef.current,
    );
    if (canRemove && e.shiftKey && anchorIndex >= 0) {
      // Shift-click: select range
      e.preventDefault();
      const start = Math.min(anchorIndex, rowIndex);
      const end = Math.max(anchorIndex, rowIndex);
      const newSelection: Record<string, boolean> = {
        ...rowSelection,
        ...getRowRangeSelection(table.getRowModel().rows, start, end),
      };

      setRowSelection(newSelection);
    } else {
      // Regular click: open modal
      setSelectedScheduler(rows[rowIndex].original);
      lastClickedSchedulerKeyRef.current = rows[rowIndex].original.key;
    }
  };

  if (isError) {
    return <ErrorCard message="Could not fetch schedulers" />;
  }

  return (
    <div>
      {selectedScheduler && queue ? (
        <SchedulerModal
          canRemove={canRemove}
          canUpdate={
            queue.supports.schedulerUpdate &&
            queue.access.actions["scheduler.update"] &&
            selectedScheduler.id === undefined &&
            selectedScheduler.template?.data !== undefined
          }
          scheduler={selectedScheduler}
          queue={queue}
          onDismiss={() => setSelectedScheduler(null)}
        />
      ) : null}
      <div className="overflow-hidden rounded-xl border border-gray-100/60 dark:border-slate-800/60">
        {isLoading ? (
          <JobTableSkeleton
            layoutVariant="scheduler"
            rows={Math.min(preferences.jobsPerPage, 10)}
            selectable={canRemove}
          />
        ) : (
          <div>
            {table.getHeaderGroups().map((headerGroup) => (
              <div
                className={`sticky top-0 z-10 grid ${getTableGridClassName("scheduler", canRemove)} border-b border-gray-100/60 bg-gray-50/80 px-2 backdrop-blur dark:border-slate-800/60 dark:bg-slate-900/80 ${
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
                ariaLabel={getSchedulerRowAriaLabel(row.original)}
                isLastRow={table.getRowModel().rows.length !== rowIndex + 1}
                key={row.id}
                isSelected={canRemove && row.getIsSelected()}
                onClick={(e) => handleRowClick(e, rowIndex)}
                onKeyboardActivate={() => setSelectedScheduler(row.original)}
                layoutVariant="scheduler"
                selectable={canRemove}
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
                  No schedulers found
                </p>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {canRemove && table.getSelectedRowModel().rows.length > 0 ? (
        <div className="pointer-events-none sticky bottom-0 flex w-full items-center justify-center pb-5">
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-gray-200/60 bg-white/90 px-3 py-1.5 text-xs shadow-md backdrop-blur sm:rounded-full dark:border-slate-700/60 dark:bg-slate-900/90">
            <p className="text-gray-900 dark:text-slate-100">
              {table.getSelectedRowModel().rows.length} selected
            </p>

            <Button
              label="Delete"
              colorScheme="red"
              icon={<Trash2 className="size-3.5" />}
              size="sm"
              onClick={() => {
                bulkRemove({
                  queueName,
                  jobSchedulerIds: table
                    .getSelectedRowModel()
                    .rows.map((row) => row.original.key),
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
