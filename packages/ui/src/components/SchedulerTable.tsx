import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { clsx } from "clsx";
import cronstrue from "cronstrue";
import { CalendarPlus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { NUM_OF_RETRIES } from "../utils/config";
import { formatCount, pluralize } from "../utils/format";
import { mutationToasts } from "../utils/mutationToasts";
import { FLOATING_BAR_DOCK, HIT_AREA, TEXT_MUTED } from "../utils/styles";
import type { Queue, Scheduler } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import {
  getRowRangeSelection,
  getSchedulerRowAriaLabel,
  getSchedulerRowId,
  getSchedulerSelectionAriaLabel,
  getTableGridClassName,
  getTableCellPaddingClassName,
  getTableHeaderPaddingClassName,
  getTableMinWidthClassName,
} from "../utils/viewState";
import { AddJobModal } from "./AddJobModal";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Checkbox, ROW_SELECTION_CHECKBOX_CLASS_NAME } from "./Checkbox";
import { ErrorCard } from "./ErrorCard";
import { JobTableSkeleton } from "./JobTableSkeleton";
import { useQueuedash } from "./QueuedashProvider";
import { SchedulerModal } from "./SchedulerModal";
import { TableFrame } from "./TableFrame";
import { TableRow } from "./TableRow";
import { Timestamp } from "./Timestamp";

const columnHelper = createColumnHelper<Scheduler>();

const BROWSER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Seconds are noise on a schedule that only ever fires on the minute, and
 * every job timestamp in the dashboard already stops at minutes.
 */
const NEXT_RUN_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "numeric",
  timeZoneName: "short",
};

/**
 * A scheduler can carry any time zone string the server was configured with,
 * and an unknown zone makes `toLocaleString` throw.
 */
const formatNextRun = (value: string | number | Date, timeZone?: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  if (!timeZone) return date.toLocaleString("en-US", NEXT_RUN_FORMAT);
  try {
    return date.toLocaleString("en-US", { ...NEXT_RUN_FORMAT, timeZone });
  } catch {
    return date.toLocaleString("en-US", NEXT_RUN_FORMAT);
  }
};

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
    cell: ({ row, table }) => (
      <Checkbox
        aria-label={getSchedulerSelectionAriaLabel(row.original)}
        className={clsx(
          HIT_AREA,
          !table.getIsSomeRowsSelected() &&
            !table.getIsAllRowsSelected() &&
            ROW_SELECTION_CHECKBOX_CLASS_NAME,
        )}
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
        <span
          title={props.cell.row.original.name}
          className="truncate font-mono text-sm text-gray-900 dark:text-white"
        >
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
          className={clsx("min-w-0 truncate py-1 text-sm", TEXT_MUTED)}
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
      const scheduler = props.cell.row.original;
      if (!scheduler.next) {
        return <p className={clsx("py-1 text-sm", TEXT_MUTED)}>No next run</p>;
      }

      // The pattern column is labelled with the scheduler's own zone, so the
      // next run has to agree with it - reading a cron in PDT beside a
      // timestamp in EDT means converting by hand to check they match.
      const scheduled = formatNextRun(scheduler.next, scheduler.tz);
      const local =
        scheduler.tz && scheduler.tz !== BROWSER_TIME_ZONE
          ? formatNextRun(scheduler.next)
          : null;
      const runs = scheduler.iterationCount;

      return (
        <div
          className="flex w-full min-w-0 flex-col justify-center py-1"
          title={local ? `${scheduled} · ${local} local` : scheduled}
        >
          <span className="truncate text-sm text-gray-900 dark:text-white">
            {/* Routed through Timestamp so this column honours the Relative
                timestamp preference like every other date in the app; the
                wrapper's `title` still carries the absolute form. */}
            <Timestamp
              value={scheduler.next}
              variant="full"
              timeZone={scheduler.tz ?? undefined}
            />
            {runs === undefined ? null : (
              <span className="text-xs text-gray-400 dark:text-slate-500">
                {" "}
                ({formatCount(runs)} {pluralize(runs, "run")} total)
              </span>
            )}
          </span>
          {local ? (
            <span className={clsx("truncate text-xs", TEXT_MUTED)}>
              {local} local
            </span>
          ) : null}
        </div>
      );
    },
    header: "Next run",
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
  const [showAddSchedulerModal, setShowAddSchedulerModal] = useState(false);
  const lastClickedSchedulerKeyRef = useRef<string | null>(null);
  const { data, isError, isLoading, refetch, isRefetching } =
    trpc.scheduler.list.useQuery(
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
  const canAdd =
    queue?.supports.schedulers === true &&
    queue.access.actions["scheduler.add"] === true;

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

  const { mutate: bulkRemove, isPending: isBulkRemoving } =
    trpc.scheduler.bulkRemove.useMutation(mutationToasts("Schedulers removed"));

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
    return (
      <ErrorCard
        title="Could not fetch schedulers"
        message="The queue is reachable but its schedulers could not be read."
        onRetry={() => refetch()}
        isRetrying={isRefetching}
      />
    );
  }

  const selectedCount = table.getSelectedRowModel().rows.length;

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
      {showAddSchedulerModal && queue ? (
        <AddJobModal
          queue={queue}
          variant="scheduler"
          onDismiss={() => setShowAddSchedulerModal(false)}
        />
      ) : null}
      {canAdd ? (
        <div className="mb-3 flex justify-end">
          <Button
            label="Add scheduler"
            icon={<CalendarPlus className="size-3.5" />}
            size="sm"
            onClick={() => setShowAddSchedulerModal(true)}
          />
        </div>
      ) : null}

      <TableFrame
        ariaLabel="Schedulers"
        className="mb-4"
        skeleton={
          isLoading ? (
            <JobTableSkeleton
              layoutVariant="scheduler"
              rows={Math.min(preferences.jobsPerPage, 10)}
              selectable={canRemove}
            />
          ) : undefined
        }
        header={table.getHeaderGroups().map((headerGroup) => (
          <div
            role="row"
            className={clsx(
              "grid px-2",
              getTableGridClassName("scheduler", canRemove),
              getTableMinWidthClassName("scheduler"),
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
        // Outside the grid: the grid carries a min-width, and a centred
        // message inside it would be centred on an overflowing box in a
        // narrow embed.
        footer={
          isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-1 px-6 py-12 text-center">
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                No schedulers yet
              </p>
              <p className={clsx("max-w-sm text-sm", TEXT_MUTED)}>
                A scheduler repeats a job on a cron pattern or a fixed interval,
                so it runs without anything enqueuing it.
              </p>
            </div>
          ) : null
        }
      >
        {table.getRowModel().rows.map((row, rowIndex) => (
          <TableRow
            ariaLabel={getSchedulerRowAriaLabel(row.original)}
            hasSeparator={table.getRowModel().rows.length !== rowIndex + 1}
            key={row.id}
            isSelected={canRemove && row.getIsSelected()}
            onClick={(e) => handleRowClick(e, rowIndex)}
            onKeyboardActivate={() => setSelectedScheduler(row.original)}
            layoutVariant="scheduler"
            selectable={canRemove}
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

      {canRemove && selectedCount > 0 ? (
        <div className={FLOATING_BAR_DOCK}>
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-gray-200/60 bg-white/90 px-3 py-1.5 text-xs shadow-md backdrop-blur sm:rounded-full dark:border-slate-700/60 dark:bg-slate-900/90">
            <p className="text-gray-900 dark:text-slate-100">
              {selectedCount} selected
            </p>

            <Alert
              isPending={isBulkRemoving}
              title={`Remove ${selectedCount} ${pluralize(selectedCount, "scheduler")}?`}
              description="This action cannot be undone. Jobs already enqueued by these schedulers are left alone, but no further runs will be scheduled."
              action={
                <Button
                  variant="filled"
                  colorScheme="red"
                  label="Yes, remove"
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
              }
            >
              <Button
                as="span"
                label="Remove"
                colorScheme="red"
                icon={<Trash2 className="size-3.5" />}
                size="sm"
                isLoading={isBulkRemoving}
              />
            </Alert>
          </div>
        </div>
      ) : null}
    </div>
  );
};
