import { clsx } from "clsx";
import { GitFork, Pencil, RotateCw } from "lucide-react";
import { type FormEvent, useId, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  formatMoment,
  fromLocalInputValue,
  toLocalInputValue,
} from "../utils/dateRange";
import { formatCountLabel, formatDuration } from "../utils/format";
import type { JSONEditorValidationState } from "../utils/jsonEditor";
import { getChangedLines } from "../utils/lineDiff";
import { isFailedJob } from "../utils/status";
import {
  FIELD_HINT,
  FOCUS_FIELD,
  FOCUS_RING,
  TEXT_MUTED,
} from "../utils/styles";
import type { Job, Queue, Status } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { Button } from "./Button";
import { DetailSection } from "./DetailView";
import { JSONEditor } from "./JSONEditor";
import { JsonPane } from "./JsonPane";

/** The small text button beside a section label or a property. */
export const TEXT_BUTTON = clsx(
  "inline-flex items-center gap-1 rounded text-xs font-medium transition-colors duration-150 hover:text-gray-900 active:text-gray-600 disabled:opacity-50 dark:hover:text-white dark:active:text-slate-300",
  TEXT_MUTED,
  FOCUS_RING,
);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const INVALID: JSONEditorValidationState = {
  isValid: false,
  errorMessage: null,
};

/**
 * A job's data, and the place to fix it. Saving writes the data back onto the
 * same job, and for a failed one Save and retry runs that same job again:
 * the fix for a bad payload that a copy can't be, since a flow's parent waits
 * on this job's id.
 */
export const JobDataSection = ({
  job,
  status,
  queueName,
  queue,
  data,
  onJobLeft,
}: {
  job: Job;
  status?: Status | null;
  queueName: string;
  queue?: Queue;
  /** The job's data, parsed. */
  data: unknown;
  /** The job left this list: a retry moves it out of Failed. */
  onJobLeft?: (jobId: string) => void;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [validation, setValidation] =
    useState<JSONEditorValidationState>(INVALID);
  const original = useMemo(() => JSON.stringify(data, null, 2), [data]);
  const failed = isFailedJob(job, status);
  // Off while the server redacts or hides job data (the API says so through
  // `supports.updateData`): saving would write the placeholders back.
  const canEdit =
    queue?.supports.updateData === true &&
    queue.access.actions["job.update"] === true &&
    isPlainObject(data) &&
    status !== "active";
  const canRetry =
    failed &&
    queue?.supports.retry !== false &&
    queue?.access.actions["job.retry"] === true;
  const linksReq = trpc.flow.links.useQuery(
    { queueName, jobId: job.id },
    { enabled: draft !== null && canRetry && queue?.supports.flows === true },
  );
  const parent = linksReq.data?.parent;
  const save = trpc.job.updateData.useMutation();
  const [retrying, setRetrying] = useState(false);

  if (draft === null) {
    return (
      <DetailSection
        title="Job data"
        action={
          canEdit ? (
            <button
              type="button"
              onClick={() => setDraft(original)}
              className={TEXT_BUTTON}
            >
              <Pencil aria-hidden="true" className="size-3" />
              Edit
            </button>
          ) : undefined
        }
      >
        <JsonPane data={data} />
      </DetailSection>
    );
  }

  const changed = getChangedLines(original, draft).length;
  const isUnchanged =
    validation.isValid &&
    JSON.stringify(validation.parsedValue) === JSON.stringify(data);
  const submit = (retry: boolean) => {
    const parsed = validation.parsedValue;
    if (!validation.isValid || !isPlainObject(parsed) || isUnchanged) return;
    setRetrying(retry);
    save.mutate(
      { queueName, jobId: job.id, data: parsed, retry },
      {
        onSuccess: () => {
          toast.success(retry ? "Saved and retried" : "Job data saved");
          setDraft(null);
          if (retry) onJobLeft?.(job.id);
        },
        onError: (error) => {
          toast.error(error.message || "Could not save the job data");
        },
      },
    );
  };

  return (
    <DetailSection
      title="Job data"
      action={
        <span className="flex items-center gap-2.5">
          <span className={FIELD_HINT}>
            {draft === original
              ? "No changes"
              : changed === 0
                ? "Lines removed"
                : `${formatCountLabel(changed, "line")} changed`}
          </span>
          {draft === original ? null : (
            <button
              type="button"
              onClick={() => setDraft(original)}
              className={TEXT_BUTTON}
            >
              Reset
            </button>
          )}
        </span>
      }
    >
      <JSONEditor
        label="Editing this job's data"
        value={draft}
        onChange={setDraft}
        originalValue={original}
        rootType="object"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- Opened by pressing Edit, so focus follows the press.
        autoFocus
        height="180px"
        onValidationChange={setValidation}
        onSubmit={() => submit(false)}
      />
      {canRetry && parent ? (
        <div className="mt-1 flex items-start gap-2.5 rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-slate-800/50">
          <GitFork
            aria-hidden="true"
            className={clsx("mt-0.5 size-3.5 shrink-0", TEXT_MUTED)}
          />
          <p className="text-xs leading-[18px] text-gray-600 dark:text-slate-300">
            Retry runs this job again, not a copy, so{" "}
            <span className="font-mono text-gray-900 dark:text-white">
              {parent.name || `#${parent.id}`}
            </span>{" "}
            carries on once it passes.
          </p>
        </div>
      ) : null}
      <div className="mt-3.5 flex flex-wrap justify-end gap-2">
        <Button
          label="Cancel"
          onClick={() => setDraft(null)}
          disabled={save.isPending}
        />
        <Button
          label="Save"
          onClick={() => submit(false)}
          isLoading={save.isPending && !retrying}
          disabled={!validation.isValid || isUnchanged || save.isPending}
        />
        {canRetry ? (
          <Button
            variant="filled"
            colorScheme="brand"
            label="Save and retry"
            icon={<RotateCw className="size-3.5" />}
            onClick={() => submit(true)}
            isLoading={save.isPending && retrying}
            disabled={!validation.isValid || isUnchanged || save.isPending}
          />
        ) : null}
      </div>
    </DetailSection>
  );
};

const MINUTE = 60_000;

const tomorrowAtNine = (now: number) => {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date.getTime();
};

const CHIP = clsx(
  "h-8 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors duration-150",
  FOCUS_RING,
);

/**
 * Moves a delayed job to another time: a nudge from now, or a moment. It says
 * how that compares with the plan before anything moves.
 */
export const RescheduleSection = ({
  job,
  queueName,
  runAt,
  onDone,
}: {
  job: Job;
  queueName: string;
  /** When the job is due now. */
  runAt: number;
  onDone: () => void;
}) => {
  const [now] = useState(() => Date.now());
  const inputId = useId();
  const [value, setValue] = useState(() => toLocalInputValue(runAt));
  const target = fromLocalInputValue(value);
  const choices = [
    { label: "5 min", at: now + 5 * MINUTE },
    { label: "1 hour", at: now + 60 * MINUTE },
    {
      label: `Tomorrow, ${formatMoment(tomorrowAtNine(now), tomorrowAtNine(now))}`,
      at: tomorrowAtNine(now),
    },
  ];
  const move = trpc.job.changeDelay.useMutation();

  const difference = target === undefined ? 0 : target - runAt;
  const summary =
    target === undefined ? (
      "Pick a time."
    ) : Math.abs(difference) < 1_000 ? (
      "Pick a new time."
    ) : target <= Date.now() ? (
      <>Runs as soon as a worker is free.</>
    ) : (
      <>
        Runs at{" "}
        <span className="font-mono text-gray-900 dark:text-white">
          {formatMoment(target)}
        </span>
        , {formatDuration(Math.abs(difference))}{" "}
        {difference > 0 ? "later" : "earlier"} than planned.
      </>
    );
  const canMove = target !== undefined && Math.abs(difference) >= 1_000;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canMove || target === undefined) return;
    move.mutate(
      { queueName, jobId: job.id, runAt: target },
      {
        onSuccess: () => {
          toast.success("Job rescheduled");
          onDone();
        },
        onError: (error) => {
          toast.error(error.message || "Could not reschedule the job");
        },
      },
    );
  };

  return (
    <DetailSection
      title="Reschedule"
      action={
        <button type="button" onClick={onDone} className={TEXT_BUTTON}>
          Cancel
        </button>
      }
    >
      <form
        onSubmit={submit}
        className="flex flex-col gap-3.5 rounded-[10px] border border-gray-100 bg-gray-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60"
      >
        <div>
          <p className={clsx(FIELD_HINT, "mb-2")}>Run in</p>
          <div className="flex flex-wrap gap-1.5">
            {choices.map((choice) => {
              const isSelected =
                target !== undefined && Math.abs(target - choice.at) < 1_000;
              return (
                <button
                  key={choice.label}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setValue(toLocalInputValue(choice.at))}
                  className={clsx(
                    CHIP,
                    isSelected
                      ? "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-800/80 dark:bg-brand-950/50 dark:text-brand-300"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
                  )}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label htmlFor={inputId} className={clsx(FIELD_HINT, "mb-2 block")}>
            Or at
          </label>
          <input
            id={inputId}
            type="datetime-local"
            step={1}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className={clsx(
              "h-[34px] w-full max-w-64 rounded-lg border border-gray-200 bg-white px-2.5 font-mono text-[13px] text-gray-900 tabular-nums [color-scheme:light] transition-colors hover:border-gray-300 max-sm:h-11 max-sm:max-w-none max-sm:text-base dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:[color-scheme:dark] dark:hover:border-slate-600",
              FOCUS_FIELD,
            )}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p
            role="status"
            className="text-[13px] leading-[18px] text-gray-600 dark:text-slate-300"
          >
            {summary}
          </p>
          <Button
            type="submit"
            variant="filled"
            colorScheme="brand"
            label="Move"
            isLoading={move.isPending}
            disabled={!canMove}
            className="shrink-0"
          />
        </div>
      </form>
    </DetailSection>
  );
};

/** BullMQ's highest priority number; 0 means no priority. */
const MAX_PRIORITY = 2_097_152;

/**
 * A job's priority, and where it hasn't started yet, the place to change it:
 * lower numbers run first, and 0 takes it out of the priority order.
 */
export const PriorityValue = ({
  job,
  queueName,
  priority,
  canChange,
}: {
  job: Job;
  queueName: string;
  priority: number | null;
  canChange: boolean;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const change = trpc.job.changePriority.useMutation();
  const next = draft === null ? null : Number(draft);
  const isValid =
    next !== null &&
    draft !== "" &&
    Number.isInteger(next) &&
    next >= 0 &&
    next <= MAX_PRIORITY;

  if (draft !== null) {
    return (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!isValid || next === null) return;
          change.mutate(
            { queueName, jobId: job.id, priority: next },
            {
              onSuccess: () => {
                toast.success("Priority changed");
                setDraft(null);
              },
              onError: (error) => {
                toast.error(error.message || "Could not change the priority");
              },
            },
          );
        }}
      >
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_PRIORITY}
          step={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="Priority"
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- Opened by pressing Change, so focus follows the press.
          autoFocus
          className={clsx(
            "h-8 w-24 rounded-lg border border-gray-200 bg-gray-50 px-2.5 font-mono text-[13px] text-gray-900 tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-white",
            FOCUS_FIELD,
          )}
        />
        <Button
          label="Cancel"
          onClick={() => setDraft(null)}
          disabled={change.isPending}
        />
        <Button
          type="submit"
          variant="filled"
          colorScheme="brand"
          label="Save"
          isLoading={change.isPending}
          disabled={!isValid}
        />
        <span className={clsx("basis-full", FIELD_HINT)}>
          1 runs first; 0 is no priority.
        </span>
      </form>
    );
  }

  return (
    <span className="flex items-center justify-between gap-3">
      <span>
        <span className="font-mono text-[13px]">
          {priority ? String(priority) : "None"}
        </span>
        {priority ? (
          <span className={clsx("ml-2 text-xs", TEXT_MUTED)}>1 runs first</span>
        ) : null}
      </span>
      {canChange ? (
        <button
          type="button"
          onClick={() => setDraft(String(priority ?? 1))}
          className={TEXT_BUTTON}
        >
          {priority ? "Change" : "Set"}
        </button>
      ) : null}
    </span>
  );
};

/**
 * The id a job deduplicates on. While it holds the id, new jobs with the same
 * one are skipped; releasing it lets them in without touching this job.
 */
export const DeduplicationValue = ({
  job,
  queueName,
  deduplicationId,
  canRelease,
}: {
  job: Job;
  queueName: string;
  deduplicationId: string;
  canRelease: boolean;
}) => {
  const [released, setReleased] = useState(false);
  const release = trpc.job.removeDeduplication.useMutation();

  return (
    <span className="block">
      <span className="flex items-center justify-between gap-3">
        <span className="min-w-0 font-mono text-[13px] break-all">
          {deduplicationId}
        </span>
        {canRelease && !released ? (
          <button
            type="button"
            disabled={release.isPending}
            onClick={() =>
              release.mutate(
                { queueName, jobId: job.id },
                {
                  onSuccess: (result) => {
                    setReleased(true);
                    if (result.released) {
                      toast.success("Released. New jobs with this id get in.");
                    } else {
                      toast.info("This job no longer holds that id.");
                    }
                  },
                  onError: (error) => {
                    toast.error(error.message || "Could not release the id");
                  },
                },
              )
            }
            className={TEXT_BUTTON}
          >
            Release
          </button>
        ) : null}
      </span>
      <span className={clsx("mt-0.5 block", FIELD_HINT)}>
        {released
          ? "Released: new jobs with this id get in."
          : "New jobs with this id are skipped until this one finishes."}
      </span>
    </span>
  );
};
