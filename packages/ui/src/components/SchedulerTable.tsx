import { useRef, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { TrashIcon } from "@radix-ui/react-icons";
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
      <div className="flex w-full items-center space-x-2">
        <span className="max-w-fit grow basis-full truncate text-slate-900 dark:text-slate-200">
          {props.cell.row.original.name}
        </span>
      </div>
    ),
    header: "Scheduler",
  }),
  columnHelper.accessor("pattern", {
    cell: (props) => {
      return (
        <span className="grow basis-full truncate text-slate-900 dark:text-slate-200">
          {props.cell.row.original.pattern
            ? cronstrue.toString(props.cell.row.original.pattern, {
                verbose: true,
              })
            : props.cell.row.original.every
              ? `Every ${props.cell.row.original.every}`
              : ""}{" "}
          {props.cell.row.original.tz
            ? `(${getTimezoneAbbreviation(props.cell.row.original.tz)})`
            : ""}
        </span>
      );
    },
    header: "Pattern",
  }),
  columnHelper.accessor("next", {
    cell: (props) => {
      if (!props.cell.row.original.next) {
        return (
          <p className="text-slate-900 dark:text-slate-200">No next run</p>
        );
      }
      return (
        <Tooltip
          message={format(
            new Date(props.cell.row.original.next),
            `dd MMM yyyy HH:mm:ss zzz`,
          )}
        >
          <div className="flex items-center space-x-1.5">
            <p className="text-slate-900 dark:text-slate-200">
              In {formatDistanceToNow(new Date(props.cell.row.original.next))}{" "}
              <span className="text-sm text-slate-700 dark:text-slate-400">
                ({props.cell.row.original.iterationCount} run
                {props.cell.row.original.iterationCount === 1 ? "" : "s"} total)
              </span>
            </p>
          </div>
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
    rowIndex: number
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
      <div className="rounded-md border border-slate-200 shadow-sm dark:border-slate-700">
        {isLoading ? (
          <JobTableSkeleton />
        ) : (
          <div>
            {table.getHeaderGroups().map((headerGroup, headerIndex) => (
              <div
                className="sticky top-0 grid grid-cols-[auto,350px,1fr,1fr] rounded-t-md border-b border-slate-200 bg-slate-100/50 p-2 backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/50"
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
                layoutVariant="scheduler"
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
              </TableRow>
            ))}
          </div>
        )}
      </div>

      {table.getSelectedRowModel().rows.length > 0 ? (
        <div className="pointer-events-none sticky bottom-0 flex w-full items-center justify-center pb-5">
          <div className="pointer-events-auto flex items-center space-x-3 rounded-lg border-slate-100 bg-white/90 px-3 py-2 text-sm shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
            <p className="text-slate-900 dark:text-slate-100">{table.getSelectedRowModel().rows.length} selected</p>

            <Button
              label="Delete"
              colorScheme="red"
              icon={<TrashIcon />}
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
