import { clsx } from "clsx";
import { AlertTriangle, ChevronDown, ChevronUp, Layers } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { formatDuration } from "../utils/format";
import { parseDataOrNull, parseUnknownJson } from "../utils/json";
import { CARD_BORDER, FOCUS_RING, TEXT_MUTED } from "../utils/styles";
import type { Job, Queue, Status } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { CopyButton } from "./CopyButton";
import {
  DetailBody,
  DetailSection,
  DisclosureButton,
  LinesPane,
  Property,
  PropertyList,
} from "./DetailView";
import { JobActionMenu } from "./JobActionMenu";
import { JobTimeline } from "./JobTimeline";
import { JsonPane } from "./JsonPane";
import { useQueuedash } from "./QueuedashProvider";
import { SidePanelDialog } from "./SidePanelDialog";
import { StatusBadge } from "./StatusBadge";
import { Timestamp } from "./Timestamp";

type JobModalProps = {
  job: Job;
  status?: Status | null;
  onDismiss: () => void;
  /** An action moved or removed the job out of this list. Closes the panel if
   *  it is still on that job. */
  onJobLeft: (jobId: string) => void;
  queueName: string;
  /** Moves to the neighbouring job in the list the panel was opened from. */
  onStep?: (delta: 1 | -1) => void;
  canStepPrevious?: boolean;
  canStepNext?: boolean;
};

const STEP_BUTTON = clsx(
  "flex size-7 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 active:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white dark:active:bg-slate-700 dark:disabled:hover:text-slate-400",
  FOCUS_RING,
);

const readNumber = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const readBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const getProgress = (job: Job, parsedData: unknown) => {
  if (typeof job.progress === "number") return job.progress;

  if (
    parsedData &&
    typeof parsedData === "object" &&
    "progress" in parsedData &&
    typeof (parsedData as Record<string, unknown>).progress === "number"
  ) {
    return (parsedData as Record<string, unknown>).progress as number;
  }

  return null;
};

const getBackoffLabel = (value: unknown) => {
  if (!value) return null;

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const type = readString(objectValue.type);
    const delay = readNumber(objectValue.delay);

    if (type && delay !== null) {
      return `${type} (${formatDuration(delay)})`;
    }

    if (type) {
      return type;
    }
  }

  return null;
};

export const JobModal = ({
  job: initialJob,
  status: listStatus,
  queueName,
  onDismiss,
  onJobLeft,
  onStep,
  canStepPrevious = false,
  canStepNext = false,
}: JobModalProps) => {
  const { preferences } = useQueuedash();

  const queueReq = trpc.queue.byName.useQuery({
    queueName,
  });

  // The panel used to render the row snapshot it was opened with, so it went
  // stale on every poll. `byId` is unavailable when job identifiers are
  // redacted, hence the fallback to the snapshot rather than an error state.
  const liveJobReq = trpc.job.byId.useQuery(
    {
      queueName,
      jobId: initialJob.id,
    },
    {
      refetchInterval: (query) =>
        query.state.error ? false : preferences.refreshIntervalMs,
      retry: false,
    },
  );
  // Guard on the id, not just presence: while `jobId` changes (j/k stepping) the
  // previous job's data is still in the cache, so a bare `??` would render the
  // old job - and hand its id to JobActionMenu's destructive mutations.
  const liveJob =
    liveJobReq.data?.id === initialJob.id ? liveJobReq.data : null;
  const job = liveJob ?? initialJob;
  // The list's status is only as fresh as the list: a delayed job that has
  // since run kept its "Delayed" badge, and a Promote the server refused, next
  // to a live timeline that said Completed.
  const status = liveJob?.status ?? listStatus;

  return (
    <SidePanelDialog
      title={job.name}
      titleClassName="font-mono text-[15px]"
      subtitle={
        <>
          {/* The id is content, not chrome, so it overrides the header's
              faint subtitle colour. */}
          <span
            className={clsx("truncate font-mono", TEXT_MUTED)}
            title={job.id}
          >
            {job.id}
          </span>
          <CopyButton key={job.id} value={job.id} label="Job id" />
        </>
      }
      open={true}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onDismiss();
        }
      }}
      headerActions={
        <>
          {status ? <StatusBadge status={status} /> : null}
          {/* The on-screen half of j/k: the shortcut used to be advertised by
              two key caps and nothing else, so triage by mouse or touch meant
              closing the panel between every job. */}
          {onStep ? (
            <span className="flex items-center">
              <button
                type="button"
                onClick={() => onStep(-1)}
                disabled={!canStepPrevious}
                aria-label="Previous job"
                aria-keyshortcuts="k"
                title="Previous job (k)"
                className={STEP_BUTTON}
              >
                <ChevronUp aria-hidden="true" className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => onStep(1)}
                disabled={!canStepNext}
                aria-label="Next job"
                aria-keyshortcuts="j"
                title="Next job (j)"
                className={STEP_BUTTON}
              >
                <ChevronDown aria-hidden="true" className="size-4" />
              </button>
            </span>
          ) : null}
          <JobActionMenu
            key={job.id}
            job={job}
            status={status}
            queueName={queueName}
            queue={queueReq.data ?? undefined}
            onRemove={onJobLeft}
          />
        </>
      }
    >
      {/* The dialog stays mounted while j/k steps through the list, so it does
          not slide in again on every step. What holds per-job state - the
          disclosures here, the confirmation and pending actions in the menu,
          the copy tick - is keyed by job instead, so none of it carries over
          to the next one. */}
      <JobDetails
        key={job.id}
        job={job}
        queueName={queueName}
        queue={queueReq.data ?? undefined}
      />
    </SidePanelDialog>
  );
};

type JobDetailsProps = {
  job: Job;
  queueName: string;
  queue?: Queue;
};

const JobDetails = ({ job, queueName, queue }: JobDetailsProps) => {
  const [showOpts, setShowOpts] = useState(false);
  const [showFullError, setShowFullError] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const logsId = useId();
  const optsId = useId();
  const traceId = useId();

  const { data: logs } = trpc.job.logs.useQuery({
    jobId: job.id,
    queueName,
  });

  const parsedData = useMemo(() => parseDataOrNull(job.data), [job.data]);
  const parsedReturnValue = useMemo(
    () => parseDataOrNull(job.returnValue),
    [job.returnValue],
  );
  const parsedOpts = useMemo(() => {
    const opts = parseUnknownJson(job.opts);
    return opts && typeof opts === "object"
      ? (opts as Record<string, unknown>)
      : null;
  }, [job.opts]);

  const progress = getProgress(job, parsedData);
  const clampedProgress =
    progress === null ? 0 : Math.round(Math.max(0, Math.min(progress, 100)));

  // The options a job was added with are facts about the job, so they sit in
  // the same list as its queue and priority rather than in a row of pills.
  const optionRows = useMemo(() => {
    if (!parsedOpts) return [];
    const rows: Array<{ label: string; value: string; mono: boolean }> = [];

    const delay = readNumber(parsedOpts.delay);
    if (delay !== null && delay > 0) {
      rows.push({ label: "Delay", value: formatDuration(delay), mono: true });
    }
    const backoff = getBackoffLabel(parsedOpts.backoff);
    if (backoff) rows.push({ label: "Backoff", value: backoff, mono: true });
    const timeout = readNumber(parsedOpts.timeout);
    if (timeout !== null) {
      rows.push({
        label: "Timeout",
        value: formatDuration(timeout),
        mono: true,
      });
    }
    const removeOnComplete = readBoolean(parsedOpts.removeOnComplete);
    if (removeOnComplete !== null) {
      rows.push({
        label: "Remove on complete",
        value: removeOnComplete ? "Yes" : "No",
        mono: false,
      });
    }
    const removeOnFail = readBoolean(parsedOpts.removeOnFail);
    if (removeOnFail !== null) {
      rows.push({
        label: "Remove on fail",
        value: removeOnFail ? "Yes" : "No",
        mono: false,
      });
    }
    return rows;
  }, [parsedOpts]);

  const priority = parsedOpts ? readNumber(parsedOpts.priority) : null;
  const attemptsMax = parsedOpts ? readNumber(parsedOpts.attempts) : null;
  const attemptsMade = job.attemptsMade ?? 0;
  const attemptsValue =
    attemptsMade > 0
      ? attemptsMax
        ? `${attemptsMade} of ${attemptsMax}`
        : String(attemptsMade)
      : attemptsMax && attemptsMax > 1
        ? `0 of ${attemptsMax}`
        : null;

  const hasRawOpts = !!parsedOpts && Object.keys(parsedOpts).length > 0;
  const supportsLogs = queue?.supports.logs === true;
  const logLines = Array.isArray(logs) ? logs : null;
  const stacktrace = job.stacktrace ?? [];

  return (
    <DetailBody>
      {/* Where the job is in its life, and - if it failed - why. The failure
          leads: on a failed job the error is what the panel was opened for. */}
      <DetailSection>
        {progress !== null && job.processedAt && !job.finishedAt ? (
          <div className="mb-4 rounded-lg bg-gray-50/80 px-3 py-2.5 dark:bg-slate-800/40">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  aria-hidden="true"
                  className="size-1.5 animate-heartbeat rounded-full bg-gray-900 dark:bg-slate-100"
                />
                <span className="text-xs font-medium text-gray-900 dark:text-white">
                  Processing
                </span>
              </div>
              <span
                className={clsx(
                  "font-mono text-xs font-medium tabular-nums",
                  TEXT_MUTED,
                )}
              >
                {clampedProgress}%
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Job progress"
              aria-valuenow={clampedProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1 w-full overflow-hidden rounded-full bg-gray-200/60 dark:bg-slate-700/60"
            >
              {/* Translated rather than width-animated: width is layout-triggering,
                  and scaleX would flatten the rounded cap. */}
              <div
                className="h-full w-full rounded-full bg-gray-900 transition-transform duration-200 ease-out dark:bg-slate-100"
                style={{
                  transform: `translateX(-${100 - clampedProgress}%)`,
                }}
              />
            </div>
          </div>
        ) : null}

        <JobTimeline job={job} />

        {job.failedReason ? (
          <div className="mt-4 rounded-lg bg-red-50/80 p-3 dark:bg-red-950/20">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-500 dark:text-red-400" />
              <div className="min-w-0 flex-1">
                <p className="mb-1.5 text-xs font-medium text-red-800 dark:text-red-300">
                  Failed reason
                </p>
                <pre className="overflow-wrap-anywhere font-mono text-xs break-all whitespace-pre-wrap text-red-700/90 dark:text-red-400/80">
                  {showFullError || job.failedReason.length <= 300
                    ? job.failedReason
                    : `${job.failedReason.slice(0, 300)}…`}
                </pre>
                <div className="mt-1.5 flex flex-wrap gap-x-3">
                  {job.failedReason.length > 300 ? (
                    <button
                      type="button"
                      aria-expanded={showFullError}
                      onClick={() => setShowFullError((prev) => !prev)}
                      className={clsx(
                        "rounded text-xs font-medium text-red-600 transition-colors duration-150 hover:text-red-800 active:text-red-900 dark:text-red-400 dark:hover:text-red-300 dark:active:text-red-200",
                        FOCUS_RING,
                      )}
                    >
                      {showFullError ? "Show less" : "Show more"}
                    </button>
                  ) : null}
                  {stacktrace.length > 0 ? (
                    <button
                      type="button"
                      aria-expanded={showTrace}
                      aria-controls={traceId}
                      onClick={() => setShowTrace((prev) => !prev)}
                      className={clsx(
                        "rounded text-xs font-medium text-red-600 transition-colors duration-150 hover:text-red-800 active:text-red-900 dark:text-red-400 dark:hover:text-red-300 dark:active:text-red-200",
                        FOCUS_RING,
                      )}
                    >
                      {showTrace ? "Hide" : "Show"} stack trace
                    </button>
                  ) : null}
                </div>
                <div id={traceId}>
                  {showTrace && stacktrace.length > 0 ? (
                    <div className="mt-2.5">
                      <LinesPane lines={stacktrace} tone="error" />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </DetailSection>

      <DetailSection
        title="Properties"
        action={
          hasRawOpts ? (
            <DisclosureButton
              isOpen={showOpts}
              controls={optsId}
              onToggle={() => setShowOpts((prev) => !prev)}
            >
              {showOpts ? "Hide raw options" : "Raw options"}
            </DisclosureButton>
          ) : undefined
        }
      >
        <PropertyList>
          <Property label="Queue" value={queue?.displayName ?? queueName} />
          {job.groupId ? (
            <Property
              label="Group"
              mono
              value={
                <span className="flex items-start gap-1.5">
                  <Layers
                    aria-hidden="true"
                    className="mt-1 size-3 shrink-0 text-purple-500 dark:text-purple-400"
                  />
                  <span className="min-w-0 break-all">{job.groupId}</span>
                </span>
              }
            />
          ) : null}
          {priority !== null ? (
            <Property label="Priority" mono value={String(priority)} />
          ) : null}
          {attemptsValue !== null ? (
            <Property label="Attempts" mono value={attemptsValue} />
          ) : null}
          {optionRows.map((row) => (
            <Property
              key={row.label}
              label={row.label}
              mono={row.mono}
              value={row.value}
            />
          ))}
          <Property
            label="Created"
            value={<Timestamp value={job.createdAt} variant="full" />}
          />
          {job.retriedAt ? (
            <Property
              label="Retried"
              value={<Timestamp value={job.retriedAt} variant="full" />}
            />
          ) : null}
        </PropertyList>
        <div id={optsId}>
          {showOpts && hasRawOpts ? (
            <JsonPane data={parsedOpts} className="mt-3" />
          ) : null}
        </div>
      </DetailSection>

      {parsedData !== null ? (
        <DetailSection title="Job data">
          <JsonPane data={parsedData} />
        </DetailSection>
      ) : null}

      {parsedReturnValue !== null ? (
        <DetailSection title="Return value">
          <JsonPane data={parsedReturnValue} />
        </DetailSection>
      ) : null}

      {supportsLogs && logLines ? (
        <DetailSection
          title="Logs"
          action={
            <DisclosureButton
              isOpen={showLogs}
              controls={logsId}
              onToggle={() => setShowLogs((prev) => !prev)}
            >
              {showLogs
                ? "Hide"
                : `Show${logLines.length ? ` (${logLines.length})` : ""}`}
            </DisclosureButton>
          }
        >
          {showLogs ? (
            <div id={logsId}>
              {logLines.length > 0 ? (
                <LinesPane lines={logLines} />
              ) : (
                <p
                  className={clsx(
                    "rounded-lg px-3 py-2.5 text-xs",
                    CARD_BORDER,
                    TEXT_MUTED,
                  )}
                >
                  This job has not written any logs.
                </p>
              )}
            </div>
          ) : null}
        </DetailSection>
      ) : null}

      {/* Only when there is no error to nest it under - a stack trace without
          a failed reason has nowhere else to go. */}
      {!job.failedReason && stacktrace.length > 0 ? (
        <DetailSection
          title="Stack trace"
          action={
            <DisclosureButton
              isOpen={showTrace}
              controls={traceId}
              onToggle={() => setShowTrace((prev) => !prev)}
            >
              {showTrace ? "Hide" : "Show"}
            </DisclosureButton>
          }
        >
          {showTrace ? (
            <div id={traceId}>
              <LinesPane lines={stacktrace} />
            </div>
          ) : null}
        </DetailSection>
      ) : null}
    </DetailBody>
  );
};
