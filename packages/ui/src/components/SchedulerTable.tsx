import { useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { CounterClockwiseClockIcon, TrashIcon } from "@radix-ui/react-icons";
import type { Job, Scheduler } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { TableRow } from "./TableRow";
import { JobTableSkeleton } from "./JobTableSkeleton";
import { Checkbox } from "./Checkbox";
import { JobModal } from "./JobModal";
import { Button } from "./Button";
import cronstrue from "cronstrue";
import { Tooltip } from "./Tooltip";
import { format, formatDistanceToNow } from "date-fns";

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
      </div>
    ),
    header: "Scheduler",
  }),
  columnHelper.accessor("repeat", {
    cell: (props) => (
      <span className="grow basis-full truncate text-slate-900 dark:text-slate-200">
        {cronstrue.toString(props.cell.row.original.pattern, {
          verbose: true,
        })}{" "}
        ({getTimezoneAbbreviation(props.cell.row.original.tz)})
      </span>
    ),
    header: "Pattern",
  }),
  columnHelper.accessor("next", {
    cell: (props) => (
      <Tooltip
        message={format(
          new Date(props.cell.row.original.next),
          `dd MMM yyyy HH:mm:ss zzz`,
        )}
      >
        <div className="flex items-center space-x-1.5">
          <p className="text-slate-900 dark:text-slate-200">
            In {formatDistanceToNow(new Date(props.cell.row.original.next))}{" "}
            <span className="text-sm text-slate-700">
              ({props.cell.row.original.iterationCount} run
              {props.cell.row.original.iterationCount === 1 ? "" : "s"} total)
            </span>
          </p>
        </div>
      </Tooltip>
    ),
    header: "Next Run",
  }),
];

type SchedulerTableProps = {
  queueName: string;
};
export const SchedulerTable = ({ queueName }: SchedulerTableProps) => {
  const [rowSelection, setRowSelection] = useState({});
  const { data, isLoading } = trpc.scheduler.list.useQuery({
    queueName,
  });

  const isEmpty = data?.length === 0;

  const table = useReactTable({
    data: data || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: {
      rowSelection,
    },
    onRowSelectionChange: setRowSelection,
  });

  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const { mutate: retry } = trpc.job.retry.useMutation();
  const { mutate: rerun } = trpc.job.rerun.useMutation();
  const { mutate: bulkRemove } = trpc.job.bulkRemove.useMutation();

  if (!isLoading && isEmpty) return null;

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
                onClick={() => setSelectedJob(row.original)}
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
          <div className="pointer-events-auto flex items-center space-x-3 rounded-lg border-slate-100 bg-white/90 px-3 py-2 text-sm shadow-lg backdrop-blur">
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
