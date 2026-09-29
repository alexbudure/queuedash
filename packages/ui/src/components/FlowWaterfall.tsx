import { clsx } from "clsx";
import { ChevronDown, CircleX } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

import {
  type FlowJob,
  type FlowRow,
  type FlowSegment,
  formatTick,
  getFlowSegments,
  getFlowTicks,
  getFlowTook,
  toListStatus,
} from "../utils/flow";
import { formatDuration } from "../utils/format";
import { STATUS_ICONS, STATUS_LABELS, STATUS_TINT } from "../utils/status";
import { FOCUS_RING, FOCUS_RING_INSET, TEXT_MUTED } from "../utils/styles";
import { PHONE_HAIRLINE } from "./phoneStyles";

// Job | Status | Took | the clock. The clock gets the room: it is what the
// view is for.
const GRID_COLUMNS = "minmax(340px, 2.2fr) 132px 76px minmax(300px, 2.8fr)";
const INDENT_PX = 20;
// Phone rows have no guides to fill, so a shallower step still reads as a
// tree without pushing deep names off the screen.
const PHONE_INDENT_PX = 14;
const SHORT_ID_LENGTH = 12;

const SEGMENT_FILL: Record<FlowSegment["kind"], string> = {
  waiting: "bg-gray-300 dark:bg-slate-600",
  children: "qd-flow-children",
  running: "qd-flow-running",
  ran: "bg-green-500",
  failed: "bg-red-500",
};

// The table's bars, where the hatched one sits a little thinner than the
// solid ones. The phone track is one height for all of them.
const segmentClass = (kind: FlowSegment["kind"]) =>
  clsx(kind === "children" ? "h-2" : "h-2.5", SEGMENT_FILL[kind]);

const PHONE_ROW = "border-t py-3";

type JobRow = Extract<FlowRow, { kind: "job" }>;

export const FlowStatusPill = ({
  job,
  className,
}: {
  job: FlowJob;
  className?: string;
}) => {
  const status = toListStatus(job.status);
  if (!status) {
    return (
      <span
        className={clsx(
          "inline-flex h-6 items-center rounded-full border border-gray-200 px-2 text-[11px] font-medium whitespace-nowrap dark:border-slate-700",
          TEXT_MUTED,
          className,
        )}
      >
        {job.status === "removed" ? "Removed" : "Unknown"}
      </span>
    );
  }
  const Icon = STATUS_ICONS[status];
  const attempts =
    status === "failed" && job.attempts && job.attempts > 1
      ? ` · ${job.attemptsMade} of ${job.attempts}`
      : "";
  return (
    <span
      className={clsx(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap",
        STATUS_TINT[status],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {STATUS_LABELS[status]}
      {attempts}
    </span>
  );
};

type FlowWaterfallProps = {
  rows: FlowRow[];
  clock: { start: number; end: number; isOpen: boolean };
  now: number;
  selectedKey: string | null;
  focusKey: string;
  queueLabels: ReadonlyMap<string, string>;
  onSelect: (job: FlowJob) => void;
  onToggle: (key: string) => void;
  onShowMore: (parent: FlowJob) => void;
};

export const FlowWaterfall = ({
  rows,
  clock,
  now,
  selectedKey,
  focusKey,
  queueLabels,
  onSelect,
  onToggle,
  onShowMore,
}: FlowWaterfallProps) => {
  const duration = clock.end - clock.start;
  const toPercent = (time: number) =>
    Math.min(100, Math.max(0, ((time - clock.start) / duration) * 100));
  const ticks = getFlowTicks(duration);
  // A label near the right edge would sit on "now" or run off the table.
  const labelledTicks = ticks.filter(
    (tick) => tick / duration <= (clock.isOpen ? 0.88 : 0.94),
  );

  // What both layouts say about a job row.
  const describe = (row: JobRow) => {
    const { job } = row;
    const segments = getFlowSegments(job, now);
    return {
      job,
      label: job.name || `#${job.id}`,
      isSelected: selectedKey ? row.key === selectedKey : row.key === focusKey,
      took: getFlowTook(job, now),
      queueLabel:
        row.parentQueueName !== null && row.parentQueueName !== job.queueName
          ? (queueLabels.get(job.queueName) ?? job.queueName)
          : null,
      segments,
      failedAt: segments.find(({ kind }) => kind === "failed")?.to ?? null,
      open: () => {
        if (job.status !== "removed") onSelect(job);
      },
    };
  };

  const lane = (children?: ReactNode) => (
    <div className="relative h-full" role="cell">
      {ticks.map((tick) => (
        <span
          key={tick}
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-gray-100 dark:bg-slate-800/70"
          style={{ left: `${(tick / duration) * 100}%` }}
        />
      ))}
      {clock.isOpen ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 border-l border-dashed border-brand-500/70"
          style={{ left: "100%" }}
        />
      ) : null}
      {children}
    </div>
  );

  // Phone: the same rows as a list, each with its own bar on the shared
  // clock. Status and took move under the name.
  const phoneList = (
    <ul role="list" aria-label="Flow" className="sm:hidden">
      {rows.map((row) => {
        const indent = row.depth * PHONE_INDENT_PX;

        if (row.kind === "hidden") {
          return (
            <li
              key={row.key}
              className={clsx(
                PHONE_ROW,
                PHONE_HAIRLINE,
                "text-xs italic",
                TEXT_MUTED,
              )}
              style={{ paddingLeft: indent }}
            >
              {row.count === 1
                ? "1 more job in a queue you can't see"
                : `${row.count} more jobs in queues you can't see`}
            </li>
          );
        }

        if (row.kind === "more") {
          return (
            <li
              key={row.key}
              className={clsx(
                PHONE_ROW,
                PHONE_HAIRLINE,
                "flex items-center gap-2 text-xs",
              )}
              style={{ paddingLeft: indent }}
            >
              <span className={TEXT_MUTED}>
                {row.count === 1
                  ? "1 more child"
                  : `${row.count.toLocaleString("en-US")} more children`}
              </span>
              <button
                type="button"
                onClick={() => onShowMore(row.parent)}
                className={clsx(
                  "-my-2 h-10 rounded-md px-2 font-medium text-brand-600 active:bg-gray-100 dark:text-brand-300 dark:active:bg-slate-800",
                  FOCUS_RING,
                )}
              >
                Show more
              </button>
            </li>
          );
        }

        const { job, label, took, queueLabel, segments, failedAt, open } =
          describe(row);
        const isRemoved = job.status === "removed";
        const body = (
          <>
            <span
              className={clsx(
                "flex items-center gap-2",
                row.hasChildren && "pr-9",
              )}
            >
              <span
                className={clsx(
                  "min-w-0 truncate font-mono text-[13px] leading-5",
                  isRemoved ? TEXT_MUTED : "text-gray-900 dark:text-white",
                )}
                title={`${label} · #${job.id}`}
              >
                {job.name || "Removed job"}
              </span>
              {queueLabel ? (
                // One word of the queue's name: the name of the job comes
                // first, and the row is a phone wide.
                <span
                  className={clsx(
                    "max-w-24 shrink-0 truncate rounded-md border border-gray-200 px-1.5 text-[11px] leading-[17px] whitespace-nowrap dark:border-slate-700",
                    TEXT_MUTED,
                  )}
                  title={queueLabel}
                >
                  {queueLabel.split(/\s+/)[0]}
                </span>
              ) : null}
            </span>
            <span className="mt-1.5 flex items-center justify-between gap-2">
              <FlowStatusPill job={job} />
              <span
                className={clsx(
                  "font-mono text-xs",
                  took?.isLive
                    ? "text-blue-700 dark:text-blue-400"
                    : "text-gray-700 dark:text-slate-300",
                )}
              >
                {took ? formatDuration(took.ms) : "-"}
              </span>
            </span>
            {/* Every track spans the full width whatever the row's indent,
                so the bars share one clock. */}
            <span
              className="relative mt-2.5 block h-1.5 rounded-[3px] bg-gray-100 dark:bg-slate-800/60"
              style={{ marginLeft: -indent }}
            >
              {segments.map((segment) => (
                <span
                  key={`${segment.kind}-${segment.from}`}
                  title={segment.title}
                  className={clsx(
                    "absolute inset-y-0 min-w-[3px] rounded-[3px]",
                    SEGMENT_FILL[segment.kind],
                  )}
                  style={{
                    left: `${toPercent(segment.from)}%`,
                    width: `${toPercent(segment.to) - toPercent(segment.from)}%`,
                  }}
                />
              ))}
              {failedAt !== null ? (
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-900"
                  // Kept inside the track: a failure in the first instant
                  // would otherwise hang half into the gutter.
                  style={{
                    left: `clamp(6px, ${toPercent(failedAt)}%, calc(100% - 6px))`,
                  }}
                />
              ) : null}
            </span>
          </>
        );

        return (
          <li
            key={row.key}
            className={clsx(PHONE_ROW, PHONE_HAIRLINE, "relative")}
            style={{ paddingLeft: indent }}
          >
            {isRemoved ? (
              <div>{body}</div>
            ) : (
              <button
                type="button"
                onClick={open}
                className={clsx("block w-full text-left", FOCUS_RING_INSET)}
              >
                {body}
              </button>
            )}
            {/* A sibling of the row's button, not a child: the row stays a
                real button, and the toggle sits in the first line's slack. */}
            {row.hasChildren ? (
              <button
                type="button"
                aria-expanded={!row.isCollapsed}
                aria-label={`${row.isCollapsed ? "Expand" : "Collapse"} ${label}`}
                onClick={() => onToggle(row.key)}
                className={clsx(
                  "absolute top-1.5 right-0 grid size-8 place-items-center rounded-md text-gray-500 active:bg-gray-100 dark:text-slate-400 dark:active:bg-slate-800",
                  FOCUS_RING,
                )}
              >
                <ChevronDown
                  aria-hidden="true"
                  className={clsx(
                    "size-4 transition-transform duration-150",
                    row.isCollapsed && "-rotate-90",
                  )}
                />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      {phoneList}
      <div className="overflow-x-auto max-sm:hidden">
        <div
          role="table"
          aria-label="Flow"
          className="min-w-[870px] overflow-hidden rounded-xl border border-gray-200/70 tabular-nums dark:border-slate-800"
        >
          <div
            role="row"
            className="grid h-9 items-center border-b border-gray-200/70 bg-gray-50 text-xs text-gray-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400"
            style={{ gridTemplateColumns: GRID_COLUMNS }}
          >
            <div role="columnheader" className="px-3">
              Job
            </div>
            <div role="columnheader" className="px-3">
              Status
            </div>
            <div role="columnheader" className="px-3 text-right">
              Took
            </div>
            <div
              role="columnheader"
              className="relative h-full"
              aria-label="Time since the flow started"
            >
              {labelledTicks.map((tick, index) => (
                <span
                  key={tick}
                  className={clsx(
                    "absolute top-1/2 -translate-y-1/2 font-mono text-[11px] whitespace-nowrap",
                    index === 0 ? "pl-1.5" : "-translate-x-1/2",
                  )}
                  style={{ left: `${(tick / duration) * 100}%` }}
                >
                  {formatTick(tick)}
                </span>
              ))}
              {clock.isOpen ? (
                <span
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 font-mono text-[11px] font-semibold text-brand-600 dark:text-brand-300"
                  aria-hidden="true"
                >
                  now
                </span>
              ) : null}
            </div>
          </div>

          {rows.map((row) => {
            const indent = 12 + row.depth * INDENT_PX;
            const guides =
              row.depth > 0 ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-3 text-gray-200 dark:text-slate-700/80"
                  style={{
                    width: row.depth * INDENT_PX,
                    backgroundImage: `repeating-linear-gradient(to right, transparent 0 ${
                      INDENT_PX - 1
                    }px, currentColor ${INDENT_PX - 1}px ${INDENT_PX}px)`,
                  }}
                />
              ) : null;

            if (row.kind === "hidden") {
              return (
                <div
                  key={row.key}
                  role="row"
                  className="grid h-11 items-center border-b border-gray-100/80 last:border-b-0 dark:border-slate-800/60"
                  style={{ gridTemplateColumns: GRID_COLUMNS }}
                >
                  <div
                    role="cell"
                    className={clsx(
                      "relative flex h-full items-center text-xs italic",
                      TEXT_MUTED,
                    )}
                    style={{ paddingLeft: indent + 24 }}
                  >
                    {guides}
                    {row.count === 1
                      ? "1 more job in a queue you can't see"
                      : `${row.count} more jobs in queues you can't see`}
                  </div>
                  <div role="cell" />
                  <div role="cell" />
                  {lane()}
                </div>
              );
            }

            if (row.kind === "more") {
              return (
                <div
                  key={row.key}
                  role="row"
                  className="grid h-11 items-center border-b border-gray-100/80 last:border-b-0 dark:border-slate-800/60"
                  style={{ gridTemplateColumns: GRID_COLUMNS }}
                >
                  <div
                    role="cell"
                    className="relative flex h-full items-center gap-2 text-xs"
                    style={{ paddingLeft: indent + 24 }}
                  >
                    {guides}
                    <span className={TEXT_MUTED}>
                      {row.count === 1
                        ? "1 more child"
                        : `${row.count.toLocaleString("en-US")} more children`}
                    </span>
                    <button
                      type="button"
                      onClick={() => onShowMore(row.parent)}
                      className={clsx(
                        "rounded font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200",
                        FOCUS_RING,
                      )}
                    >
                      Show more
                    </button>
                  </div>
                  <div role="cell" />
                  <div role="cell" />
                  {lane()}
                </div>
              );
            }

            const {
              job,
              label,
              isSelected,
              took,
              queueLabel,
              segments,
              failedAt,
              open,
            } = describe(row);

            return (
              <div
                key={row.key}
                role="row"
                tabIndex={job.status === "removed" ? -1 : 0}
                aria-selected={isSelected}
                aria-label={`${label}, ${
                  toListStatus(job.status)
                    ? STATUS_LABELS[toListStatus(job.status)!]
                    : job.status
                }. Press Enter to open`}
                onClick={open}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    open();
                  }
                }}
                className={clsx(
                  "relative grid h-11 items-center border-b border-gray-100/80 transition-colors duration-150 last:border-b-0 dark:border-slate-800/60",
                  job.status === "removed"
                    ? "cursor-default"
                    : "cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/40",
                  isSelected &&
                    "bg-brand-50/70 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-brand-500 hover:bg-brand-50 dark:bg-brand-950/40 dark:hover:bg-brand-950/60",
                  FOCUS_RING_INSET,
                )}
                style={{ gridTemplateColumns: GRID_COLUMNS }}
              >
                <div
                  role="cell"
                  className="relative flex h-full min-w-0 items-center gap-1.5 overflow-hidden pr-3"
                  style={{ paddingLeft: indent }}
                >
                  {guides}
                  {row.hasChildren ? (
                    <button
                      type="button"
                      aria-expanded={!row.isCollapsed}
                      aria-label={`${row.isCollapsed ? "Expand" : "Collapse"} ${label}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggle(row.key);
                      }}
                      className={clsx(
                        "grid size-5 shrink-0 place-items-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white",
                        FOCUS_RING,
                      )}
                    >
                      <ChevronDown
                        aria-hidden="true"
                        className={clsx(
                          "size-3.5 transition-transform duration-150",
                          row.isCollapsed && "-rotate-90",
                        )}
                      />
                    </button>
                  ) : (
                    <span aria-hidden="true" className="w-5 shrink-0" />
                  )}
                  <span
                    className={clsx(
                      "min-w-0 truncate font-mono text-[13px]",
                      job.status === "removed"
                        ? TEXT_MUTED
                        : "text-gray-900 dark:text-white",
                    )}
                    title={`${label} · #${job.id}`}
                  >
                    {job.name || "Removed job"}
                  </span>
                  {/* A short id tells jobs apart at a glance; a UUID, which
                      BullMQ 6 gives flow jobs, only crowds the name out. */}
                  {job.id.length <= SHORT_ID_LENGTH ? (
                    <span
                      className={clsx(
                        "shrink-0 rounded-md bg-gray-100 px-1.5 font-mono text-[11px] leading-[18px] dark:bg-slate-800",
                        TEXT_MUTED,
                      )}
                    >
                      #{job.id}
                    </span>
                  ) : null}
                  {queueLabel ? (
                    <span
                      className={clsx(
                        "shrink-0 rounded-md border border-gray-200 px-1.5 text-[11px] leading-[17px] whitespace-nowrap dark:border-slate-700",
                        TEXT_MUTED,
                      )}
                    >
                      {queueLabel}
                    </span>
                  ) : null}
                </div>
                <div role="cell" className="px-3">
                  <FlowStatusPill job={job} />
                </div>
                <div
                  role="cell"
                  className={clsx(
                    "px-3 text-right font-mono text-xs",
                    took?.isLive
                      ? "text-blue-700 dark:text-blue-400"
                      : "text-gray-700 dark:text-slate-300",
                  )}
                >
                  {took ? formatDuration(took.ms) : "-"}
                </div>
                {lane(
                  <>
                    {segments.map((segment) => (
                      <span
                        key={`${segment.kind}-${segment.from}`}
                        title={segment.title}
                        className={clsx(
                          "absolute top-1/2 min-w-[3px] -translate-y-1/2 rounded-[3px]",
                          segmentClass(segment.kind),
                        )}
                        style={{
                          left: `${toPercent(segment.from)}%`,
                          width: `${toPercent(segment.to) - toPercent(segment.from)}%`,
                        }}
                      />
                    ))}
                    {failedAt !== null ? (
                      <span
                        aria-hidden="true"
                        className="absolute top-1/2 grid size-3.5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-red-500 dark:bg-slate-900"
                        style={{ left: `${toPercent(failedAt)}%` }}
                      >
                        <CircleX className="size-3" />
                      </span>
                    ) : null}
                  </>,
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};
