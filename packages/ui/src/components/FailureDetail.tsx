import { clsx } from "clsx";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  RotateCcw,
} from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router";

import { formatCount } from "../utils/format";
import {
  type Attempt,
  getAppFrame,
  groupStackRows,
  parseStack,
  type StackFrame,
} from "../utils/stack";
import {
  FOCUS_RING,
  FOCUS_RING_INSET,
  TEXT_FAINT,
  TEXT_MUTED,
} from "../utils/styles";
import type { Job } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { DetailSection } from "./DetailView";
import { OpenInEditor } from "./OpenInEditor";

const FAILED_TONE = {
  box: "bg-red-50/80 dark:bg-red-950/20",
  icon: "text-red-500 dark:text-red-400",
  title: "text-red-800 dark:text-red-300",
  text: "text-red-700/90 dark:text-red-400/80",
  rule: "border-red-200/80 dark:border-red-900/50",
  link: "text-red-600 hover:text-red-800 active:text-red-900 dark:text-red-400 dark:hover:text-red-300 dark:active:text-red-200",
};

// Bull and BullMQ keep a job's last failure reason after a retry succeeds, so
// on a job that did not end in failure the reason is history, not the outcome.
const EARLIER_FAILURE_TONE = {
  box: "bg-gray-50/80 dark:bg-slate-800/40",
  icon: TEXT_FAINT,
  title: "text-gray-900 dark:text-white",
  text: "text-gray-600 dark:text-slate-300",
  rule: "border-gray-200/80 dark:border-slate-700/60",
  link: `${TEXT_MUTED} hover:text-gray-900 active:text-gray-600 dark:hover:text-white dark:active:text-slate-300`,
};

const MESSAGE_PREVIEW_LENGTH = 300;

const readAttemptLimit = (opts: unknown): number | null => {
  const attempts =
    opts && typeof opts === "object"
      ? (opts as Record<string, unknown>).attempts
      : undefined;
  return typeof attempts === "number" && attempts > 0 ? attempts : null;
};

const describeAttempt = (
  failed: boolean,
  number: number | null,
  limit: number | null,
) => {
  if (!failed) {
    return number === null
      ? "An earlier attempt failed"
      : `Attempt ${number} failed`;
  }
  if (number === null) return "Failed";
  return limit !== null && limit >= number
    ? `Failed on attempt ${number} of ${limit}`
    : `Failed on attempt ${number}`;
};

const formatFrame = (frame: StackFrame) =>
  `at ${frame.fn ?? "(anonymous)"} · ${frame.label}${
    frame.line === null ? "" : `:${frame.line}`
  }`;

/**
 * What went wrong, where, and whether it is only this job: the reason the
 * panel was opened, so it leads.
 */
export const FailureSummary = ({
  job,
  failed,
  attempts,
  errorFingerprint,
  queueName,
}: {
  job: Job;
  failed: boolean;
  attempts: Attempt[];
  errorFingerprint: string | null;
  queueName: string;
}) => {
  const tone = failed ? FAILED_TONE : EARLIER_FAILURE_TONE;
  const [showFullMessage, setShowFullMessage] = useState(false);
  const latest = attempts[0];
  const reason = useMemo(
    () => parseStack(job.failedReason ?? ""),
    [job.failedReason],
  );
  const type = latest?.stack.type ?? reason.type;
  const message = (latest?.stack.message || reason.message || "").trim();
  const frame = latest ? getAppFrame(latest.stack) : null;
  const attemptLabel = describeAttempt(
    failed,
    latest?.number ??
      (failed && job.attemptsMade ? job.attemptsMade : null) ??
      null,
    readAttemptLimit(job.opts),
  );

  // Only a job that failed for good is in an error group.
  const groupsReq = trpc.job.errorGroups.useQuery(
    { queueName, range: "24h" },
    { enabled: failed && errorFingerprint !== null, staleTime: 30_000 },
  );
  const group = groupsReq.data?.groups.find(
    ({ fingerprint }) => fingerprint === errorFingerprint,
  );
  const groupPath =
    errorFingerprint === null
      ? null
      : `/queues/${encodeURIComponent(queueName)}?status=failed&error=${errorFingerprint}`;

  return (
    <div className={clsx("mt-4 rounded-lg p-3", tone.box)}>
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          aria-hidden="true"
          className={clsx("mt-0.5 size-3.5 shrink-0", tone.icon)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span
              className={clsx(
                "min-w-0 truncate text-xs",
                type ? "font-mono font-semibold" : "font-medium",
                tone.title,
              )}
            >
              {type ?? attemptLabel}
            </span>
            {type ? (
              <span className={clsx("shrink-0 text-xs", tone.text)}>
                {attemptLabel}
              </span>
            ) : null}
          </div>

          {message ? (
            <p
              className={clsx(
                "mt-1 text-sm font-medium break-words whitespace-pre-wrap",
                tone.title,
              )}
            >
              {showFullMessage || message.length <= MESSAGE_PREVIEW_LENGTH
                ? message
                : `${message.slice(0, MESSAGE_PREVIEW_LENGTH)}…`}
            </p>
          ) : null}
          {message.length > MESSAGE_PREVIEW_LENGTH ? (
            <button
              type="button"
              aria-expanded={showFullMessage}
              onClick={() => setShowFullMessage((current) => !current)}
              className={clsx(
                "mt-1 rounded text-xs font-medium transition-colors duration-150",
                tone.link,
                FOCUS_RING,
              )}
            >
              {showFullMessage ? "Show less" : "Show more"}
            </button>
          ) : null}

          {frame ? (
            <div
              className={clsx(
                "mt-2 flex items-center justify-between gap-3 max-sm:mt-2.5 max-sm:min-h-11 max-sm:border-t max-sm:py-1.5",
                tone.rule,
              )}
            >
              <span
                title={`${frame.path}${frame.line === null ? "" : `:${frame.line}`}`}
                className={clsx(
                  "min-w-0 truncate font-mono text-xs max-sm:hidden",
                  tone.text,
                )}
              >
                {formatFrame(frame)}
              </span>
              {/* A phone has no room for both on one line, and a truncated
                  path was just "src/…": the file goes under the function. */}
              <span className="min-w-0 font-mono text-xs leading-[17px] sm:hidden">
                <span className={clsx("block truncate", tone.title)}>
                  {frame.fn ?? "(anonymous)"}
                </span>
                <span className={clsx("block break-words", tone.text)}>
                  <BreakablePath path={frame.label} />
                  {frame.line === null ? "" : `:${frame.line}`}
                </span>
              </span>
              <OpenInEditor
                frame={frame}
                variant="text"
                className={tone.link}
              />
            </div>
          ) : null}

          {failed && groupPath && groupsReq.data ? (
            <div
              className={clsx(
                "mt-3 flex items-center justify-between gap-3 border-t pt-2.5 text-xs",
                tone.rule,
                tone.text,
              )}
            >
              <span>
                {group && group.count > 1 ? (
                  <>
                    <b className={clsx("font-semibold", tone.title)}>
                      {formatCount(group.count)} jobs
                    </b>{" "}
                    failed with this error in the last 24 hours
                  </>
                ) : group ? (
                  "No other job failed with this error in the last 24 hours"
                ) : (
                  "Other jobs that failed with this error"
                )}
              </span>
              {!group || group.count > 1 ? (
                <Link
                  to={groupPath}
                  className={clsx(
                    "inline-flex shrink-0 items-center gap-1 rounded font-medium transition-colors duration-150",
                    tone.link,
                    FOCUS_RING,
                  )}
                >
                  View all
                  <ArrowRight aria-hidden="true" className="size-3" />
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export type StallFacts = {
  stalledCounter: number;
  /** Only once the job has finished: until then a run may be under way. */
  runsStarted: number | null;
  attemptsCounted: number | null;
};

/**
 * Every failed attempt the job kept a trace of, newest first and open. The
 * app's own frames lead; library code folds into a line per run of frames.
 */
export const AttemptsSection = ({
  attempts,
  stall,
}: {
  attempts: Attempt[];
  stall: StallFacts | null;
}) => {
  // By position, newest first: the panel is keyed by job, so this resets per job.
  const [openAttempts, setOpenAttempts] = useState<ReadonlySet<number>>(
    () => new Set([0]),
  );
  const latestNumber = attempts[0]?.number ?? null;

  return (
    <DetailSection
      title="Attempts"
      action={
        attempts.length > 0 ? (
          <CopyStacksButton attempts={attempts} />
        ) : undefined
      }
    >
      {attempts.length > 0 ? (
        <div className="overflow-hidden rounded-[10px] border border-gray-100 dark:border-slate-800">
          {attempts.map((attempt, index) => (
            <AttemptRow
              // Stacks are only ever added, newest first, so a position keeps
              // naming the same attempt between polls.
              key={index}
              attempt={attempt}
              latestNumber={latestNumber}
              isFirst={index === 0}
              isOpen={openAttempts.has(index)}
              onToggle={() =>
                setOpenAttempts((current) => {
                  const next = new Set(current);
                  if (next.has(index)) next.delete(index);
                  else next.add(index);
                  return next;
                })
              }
            />
          ))}
        </div>
      ) : null}
      {stall ? (
        <StallNote
          stall={stall}
          className={attempts.length > 0 ? "mt-3" : ""}
        />
      ) : null}
    </DetailSection>
  );
};

const AttemptRow = ({
  attempt,
  latestNumber,
  isFirst,
  isOpen,
  onToggle,
}: {
  attempt: Attempt;
  latestNumber: number | null;
  isFirst: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) => {
  const contentId = useId();
  const rows = useMemo(
    () => groupStackRows(attempt.stack.frames),
    [attempt.stack.frames],
  );
  const [openLibraries, setOpenLibraries] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  return (
    <div
      className={clsx(
        !isFirst && "border-t border-gray-100 dark:border-slate-800",
      )}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={onToggle}
        className={clsx(
          "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-slate-800/60 dark:active:bg-slate-800",
          FOCUS_RING_INSET,
        )}
      >
        <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-red-200 bg-red-50 font-mono text-[11px] font-semibold text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400">
          <span className="sr-only">Attempt </span>
          {attempt.number ?? "·"}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {attempt.isSameAsLatest ? (
            <span className={clsx("text-[13px] leading-[18px]", TEXT_MUTED)}>
              Same error as{" "}
              {latestNumber === null
                ? "the latest attempt"
                : `attempt ${latestNumber}`}
            </span>
          ) : (
            <>
              {attempt.stack.type ? (
                <span className="font-mono text-xs font-semibold text-gray-900 dark:text-white">
                  {attempt.stack.type}
                </span>
              ) : null}
              <span className="text-[13px] leading-[18px] break-words text-gray-900 dark:text-white">
                {attempt.stack.message || "No message"}
              </span>
            </>
          )}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={clsx(
            "mt-0.5 size-4 shrink-0 text-gray-400 transition-transform duration-150 dark:text-slate-500",
            isOpen && "rotate-180",
          )}
        />
      </button>

      <div id={contentId}>
        {isOpen ? (
          <div className="pr-2 pb-2.5 pl-[34px]">
            {rows.length === 0 ? (
              <p className={clsx("px-2 py-1 text-xs", TEXT_MUTED)}>
                This trace has no frames.
              </p>
            ) : (
              rows.map((row) =>
                row.kind === "frame" ? (
                  <FrameRow key={row.index} frame={row.frame} />
                ) : (
                  <LibraryFrames
                    key={row.index}
                    frames={row.frames}
                    pkgs={row.pkgs}
                    isOpen={openLibraries.has(row.index)}
                    onToggle={() =>
                      setOpenLibraries((current) => {
                        const next = new Set(current);
                        if (next.has(row.index)) next.delete(row.index);
                        else next.add(row.index);
                        return next;
                      })
                    }
                  />
                ),
              )
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};

// On a phone the file sits under the function, whole, rather than beside it
// cut down to "src…".
/** A path that wraps after a "/" rather than inside a name or a line number. */
const BreakablePath = ({ path }: { path: string }) => (
  <>
    {path.split("/").map((part, index) => (
      <Fragment key={index}>
        {index > 0 ? (
          <>
            /<wbr />
          </>
        ) : null}
        {part}
      </Fragment>
    ))}
  </>
);

const FRAME_GRID =
  "grid min-h-7 grid-cols-[minmax(0,13rem)_minmax(0,1fr)_1.5rem] items-center gap-x-3 rounded-md pr-0.5 pl-2 max-sm:min-h-12 max-sm:grid-cols-[minmax(0,1fr)_1.5rem] max-sm:py-1.5";

const FrameRow = ({
  frame,
  isLibrary = false,
}: {
  frame: StackFrame;
  isLibrary?: boolean;
}) => (
  <div
    className={clsx(
      FRAME_GRID,
      "transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-slate-800/60",
    )}
  >
    <span
      title={frame.fn ?? undefined}
      className={clsx(
        "truncate font-mono text-xs max-sm:col-start-1 max-sm:row-start-1 max-sm:text-[13px] max-sm:leading-[18px]",
        isLibrary ? TEXT_MUTED : "text-gray-900 dark:text-white",
      )}
    >
      {frame.fn ?? "(anonymous)"}
    </span>
    <span
      title={`${frame.path}${frame.line === null ? "" : `:${frame.line}:${frame.column ?? 1}`}`}
      className={clsx(
        "truncate font-mono text-xs max-sm:col-start-1 max-sm:row-start-2 max-sm:leading-4 max-sm:break-words max-sm:whitespace-normal",
        TEXT_MUTED,
      )}
    >
      <BreakablePath path={frame.label} />
      {frame.line === null ? null : (
        <span className={TEXT_FAINT}>
          :{frame.line}
          {frame.column === null ? "" : `:${frame.column}`}
        </span>
      )}
    </span>
    <span className="flex max-sm:col-start-2 max-sm:row-span-2 max-sm:row-start-1 max-sm:justify-center">
      {isLibrary ? null : <OpenInEditor frame={frame} variant="icon" />}
    </span>
  </div>
);

const LibraryFrames = ({
  frames,
  pkgs,
  isOpen,
  onToggle,
}: {
  frames: StackFrame[];
  pkgs: string[];
  isOpen: boolean;
  onToggle: () => void;
}) => {
  const noun = frames.length === 1 ? "library frame" : "library frames";
  return (
    <>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        className={clsx(
          "flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs transition-colors duration-150 hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-slate-800/60 dark:hover:text-white",
          TEXT_MUTED,
          FOCUS_RING_INSET,
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className={clsx(
            "size-3 shrink-0 transition-transform duration-150",
            isOpen && "rotate-90",
          )}
        />
        <span className="truncate">
          {isOpen
            ? `Hide ${frames.length} ${noun}`
            : `${frames.length} ${noun}${pkgs.length > 0 ? ` · ${pkgs.join(", ")}` : ""}`}
        </span>
      </button>
      {isOpen
        ? frames.map((frame, index) => (
            <FrameRow key={index} frame={frame} isLibrary />
          ))
        : null}
    </>
  );
};

const CopyStacksButton = ({ attempts }: { attempts: Attempt[] }) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const text =
    attempts.length === 1
      ? (attempts[0]?.stack.raw ?? "")
      : attempts
          .map(
            ({ number, stack }) =>
              `${number === null ? "Attempt" : `Attempt ${number}`}\n${stack.raw}`,
          )
          .join("\n\n");

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // No clipboard (insecure context, denied permission): nothing to confirm.
        }
      }}
      className={clsx(
        "inline-flex items-center gap-1 rounded text-xs font-medium transition-colors duration-150 hover:text-gray-900 active:text-gray-600 dark:hover:text-white dark:active:text-slate-300",
        TEXT_MUTED,
        FOCUS_RING,
      )}
    >
      {copied ? (
        <Check
          aria-hidden="true"
          className="size-3 text-green-600 dark:text-green-400"
        />
      ) : (
        <Copy aria-hidden="true" className="size-3" />
      )}
      {copied ? "Copied" : attempts.length === 1 ? "Copy stack" : "Copy stacks"}
    </button>
  );
};

const StallNote = ({
  stall,
  className,
}: {
  stall: StallFacts;
  className?: string;
}) => {
  const { stalledCounter, runsStarted, attemptsCounted } = stall;
  return (
    <div
      className={clsx(
        "flex items-start gap-2.5 rounded-lg bg-gray-50/80 px-3 py-2.5 dark:bg-slate-800/40",
        className,
      )}
    >
      <RotateCcw
        aria-hidden="true"
        className={clsx("mt-0.5 size-3.5 shrink-0", TEXT_MUTED)}
      />
      <p className="text-xs leading-[18px] text-gray-600 dark:text-slate-300">
        <span className="font-semibold text-gray-900 dark:text-white">
          {stalledCounter === 1
            ? "Stalled once."
            : `Stalled ${formatCount(stalledCounter)} times.`}
        </span>{" "}
        The worker running it stopped renewing the job's lock (it crashed, was
        stopped, or blocked its event loop), so BullMQ started the run again
        without counting an attempt.
        {runsStarted !== null &&
        attemptsCounted !== null &&
        runsStarted > attemptsCounted
          ? ` That's why ${formatCount(runsStarted)} runs started for ${formatCount(attemptsCounted)} ${attemptsCounted === 1 ? "attempt" : "attempts"}.`
          : null}
      </p>
    </div>
  );
};
