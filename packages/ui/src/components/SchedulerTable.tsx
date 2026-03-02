import { useRef, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Trash2 } from "lucide-react";
import type { Scheduler } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { TableRow } from "./TableRow";
import { JobTableSkeleton } from "./JobTableSkeleton";
import { Checkbox } from "./Checkbox";
import { Button } from "./Button";
import cronstrue from "cronstrue";
import { Tooltip } from "./Tooltip";
import { format, formatDistanceToNow } from "date-fns";
import { SchedulerModal } from "./SchedulerModal";

const columnHelper = createColumnHelper<Scheduler>();

function getTimezoneAbbreviation(timeZone: string, date: Date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  });

  const parts = formatter.formatToParts(date);
  const tzPart = parts.find((part) => part.type === "timeZoneName");
  return tzPart?.value || "";
}

const createColumns = (onCheckboxClick: (rowIndex: number) => void) => [
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
          onCheckedChange: (checked) => {
            row.getToggleSelectedHandler()(checked);
            onCheckboxClick(row.index);
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
        ? cronstrue.toString(scheduler.pattern, {
            verbose: true,
          })
        : scheduler.every
          ? `Every ${scheduler.every}`
          : "";
      const patternLabel = `${patternDescription}${
        scheduler.tz ? ` (${getTimezoneAbbreviation(scheduler.tz)})` : ""
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
          content={format(
            new Date(props.cell.row.original.next),
            `dd MMM yyyy HH:mm:ss zzz`,
          )}
          triggerClassName="w-full justify-start"
        >
          <span className="flex w-full min-w-0 items-center space-x-1.5 py-1">
            <span className="truncate text-sm text-gray-900 dark:text-white">
              In {formatDistanceToNow(new Date(props.cell.row.original.next))}{" "}
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
  queueName: string;
};
export const SchedulerTable = ({ queueName }: SchedulerTableProps) => {
  const [rowSelection, setRowSelection] = useState({});
  const lastClickedIndexRef = useRef<number | null>(null);
  const { data, isLoading } = trpc.scheduler.list.useQuery({
    queueName,
  });

  const isEmpty = data?.length === 0;

  const handleCheckboxClick = (rowIndex: number) => {
    lastClickedIndexRef.current = rowIndex;
  };

  const columns = createColumns(handleCheckboxClick);

  const table = useReactTable({
    data: data || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: {
      rowSelection,
    },
    onRowSelectionChange: setRowSelection,
  });

  const [selectedScheduler, setSelectedScheduler] = useState<Scheduler | null>(
    null,
  );

  const { mutate: bulkRemove } = trpc.scheduler.bulkRemove.useMutation();

  const handleRowClick = (
    e: React.MouseEvent<HTMLDivElement>,
    rowIndex: number,
  ) => {
    if (e.shiftKey && lastClickedIndexRef.current !== null) {
      // Shift-click: select range
      e.preventDefault();
      const start = Math.min(lastClickedIndexRef.current, rowIndex);
      const end = Math.max(lastClickedIndexRef.current, rowIndex);
      const newSelection: Record<string, boolean> = { ...rowSelection };

      for (let i = start; i <= end; i++) {
        newSelection[i] = true;
      }

      setRowSelection(newSelection);
    } else {
      // Regular click: open modal
      setSelectedScheduler(table.getRowModel().rows[rowIndex].original);
      lastClickedIndexRef.current = rowIndex;
    }
  };

  if (!isLoading && isEmpty) return null;

  return (
    <div>
      {selectedScheduler ? (
        <SchedulerModal
          scheduler={selectedScheduler}
          queueName={queueName}
          onDismiss={() => setSelectedScheduler(null)}
        />
      ) : null}
      <div className="overflow-hidden rounded-xl border border-gray-100/60 dark:border-slate-800/60">
        {isLoading ? (
          <JobTableSkeleton />
        ) : (
          <div>
            {table.getHeaderGroups().map((headerGroup) => (
              <div
                className="sticky top-0 z-10 grid grid-cols-[36px_minmax(0,30%)_1fr_1fr] border-b border-gray-100/60 bg-gray-50/80 px-2 py-1.5 backdrop-blur dark:border-slate-800/60 dark:bg-slate-900/80"
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
                onClick={(e) => handleRowClick(e, rowIndex)}
                onKeyboardActivate={() => setSelectedScheduler(row.original)}
                layoutVariant="scheduler"
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
          </div>
        )}
      </div>

      {table.getSelectedRowModel().rows.length > 0 ? (
        <div className="pointer-events-none sticky bottom-0 flex w-full items-center justify-center pb-5">
          <div className="pointer-events-auto flex items-center space-x-3 rounded-full border border-gray-200/60 bg-white/90 px-3 py-1.5 text-xs shadow-md backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/90">
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
