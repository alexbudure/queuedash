import { clsx } from "clsx";
import { Timer } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";

import { formatCount, formatDuration, pluralize } from "../utils/format";
import { mutationToasts } from "../utils/mutationToasts";
import {
  FIELD_HINT,
  FOCUS_FIELD,
  FOCUS_RING,
  SECTION_LABEL,
} from "../utils/styles";
import type { Queue, RouterOutput } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { Button } from "./Button";
import { useQueuedash } from "./QueuedashProvider";
import { Select, type SelectOption } from "./Select";

type Limits = NonNullable<RouterOutput["queue"]["limits"]>;

/** Whether the queue's library keeps limits every worker follows. */
export const hasQueueLimits = (queue: Queue | undefined) =>
  Boolean(queue?.supports.concurrencyLimit || queue?.supports.rateLimit);

export const useQueueLimits = (queue: Queue | undefined, queueName: string) => {
  const { preferences } = useQueuedash();
  return trpc.queue.limits.useQuery(
    { queueName },
    {
      enabled: hasQueueLimits(queue),
      refetchInterval: preferences.refreshIntervalMs,
    },
  );
};

// "per second" rather than "per 1 second".
const WINDOWS: Array<{ ms: number; label: string; per: string }> = [
  { ms: 1_000, label: "1 second", per: "second" },
  { ms: 10_000, label: "10 seconds", per: "10 seconds" },
  { ms: 60_000, label: "1 minute", per: "minute" },
  { ms: 600_000, label: "10 minutes", per: "10 minutes" },
  { ms: 3_600_000, label: "1 hour", per: "hour" },
];

const describeWindow = (ms: number) =>
  WINDOWS.find((window) => window.ms === ms)?.per ?? formatDuration(ms);

const MAX_LIMIT = 1_000_000;

const parseLimit = (value: string) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= MAX_LIMIT
    ? number
    : null;
};

const TEXT_BUTTON = clsx(
  "rounded text-xs font-medium transition-colors duration-150",
  FOCUS_RING,
);
const TEXT_BUTTON_NEUTRAL = clsx(
  TEXT_BUTTON,
  "text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white",
);
const TEXT_BUTTON_DANGER = clsx(
  TEXT_BUTTON,
  "text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300",
);
const NUMBER_INPUT = clsx(
  "h-[34px] w-[84px] rounded-lg border border-gray-200 bg-gray-50 px-2.5 font-mono text-[13px] text-gray-900 tabular-nums transition-colors hover:border-gray-300 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:hover:border-slate-600",
  FOCUS_FIELD,
);
const ROW_LABEL = "text-sm text-gray-900 dark:text-white";
const STORED_HINT =
  "Stored in Redis for this queue, so every worker sticks to it.";

/**
 * The queue's global limits, beside the workers they govern: how many jobs run
 * at once across every worker, how many start per window, and whether the
 * queue is waiting out a rate-limit window right now.
 */
export const QueueLimitsSection = ({
  queue,
  queueName,
}: {
  queue: Queue;
  queueName: string;
}) => {
  const limitsReq = useQueueLimits(queue, queueName);
  const [editing, setEditing] = useState<"concurrency" | "rateLimit" | null>(
    null,
  );
  const clear = trpc.queue.clearRateLimit.useMutation(
    mutationToasts("Rate limit cleared", {
      errorMessage: "Could not clear the rate limit",
    }),
  );
  const limits = limitsReq.data;
  if (!limits) return null;
  const actions = queue.access.actions;

  return (
    <section aria-label="Limits">
      <h3 className={clsx(SECTION_LABEL, "mb-3")}>Limits</h3>
      {limits.rateLimitedForMs > 0 ? (
        <div className="mb-2 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/35">
          <Timer
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0 text-amber-700 dark:text-amber-400"
          />
          <p className="flex-1 text-[13px] leading-[18px] text-amber-800 dark:text-amber-400">
            <span className="font-semibold text-amber-900 dark:text-amber-300">
              Rate limited for {formatDuration(limits.rateLimitedForMs)}.
            </span>{" "}
            Workers pick jobs up again when the window resets.
          </p>
          {actions["queue.clearRateLimit"] ? (
            <Button
              size="sm"
              label="Clear now"
              className="shrink-0"
              isLoading={clear.isPending}
              onClick={() => clear.mutate({ queueName })}
            />
          ) : null}
        </div>
      ) : null}
      <div className="divide-y divide-gray-100 dark:divide-slate-800">
        {queue.supports.concurrencyLimit ? (
          editing === "concurrency" ? (
            <ConcurrencyEditor
              queueName={queueName}
              current={limits.concurrency}
              onDone={() => setEditing(null)}
            />
          ) : (
            <LimitRow
              label="Concurrency"
              hint={
                limits.concurrency === null
                  ? "No cap across workers"
                  : `${formatCount(limits.concurrency)} ${pluralize(
                      limits.concurrency,
                      "job",
                    )} at once, across every worker`
              }
              action={
                actions["queue.setConcurrency"]
                  ? limits.concurrency === null
                    ? "Set limit"
                    : "Edit"
                  : null
              }
              onAction={() => setEditing("concurrency")}
            />
          )
        ) : null}
        {queue.supports.rateLimit ? (
          editing === "rateLimit" ? (
            <RateLimitEditor
              queueName={queueName}
              current={limits.rateLimit}
              onDone={() => setEditing(null)}
            />
          ) : (
            <LimitRow
              label="Rate limit"
              hint={
                limits.rateLimit === null
                  ? "No cap across workers"
                  : `${formatCount(limits.rateLimit.max)} ${pluralize(
                      limits.rateLimit.max,
                      "job",
                    )} per ${describeWindow(limits.rateLimit.duration)}`
              }
              action={
                actions["queue.setRateLimit"]
                  ? limits.rateLimit === null
                    ? "Set limit"
                    : "Edit"
                  : null
              }
              onAction={() => setEditing("rateLimit")}
            />
          )
        ) : null}
      </div>
    </section>
  );
};

const LimitRow = ({
  label,
  hint,
  action,
  onAction,
}: {
  label: string;
  hint: string;
  action: string | null;
  onAction: () => void;
}) => (
  <div className="flex items-center justify-between gap-3 py-3">
    <div className="min-w-0">
      <div className={ROW_LABEL}>{label}</div>
      <div className={FIELD_HINT}>{hint}</div>
    </div>
    {action ? (
      <button
        type="button"
        onClick={onAction}
        aria-label={`${action}: ${label.toLowerCase()}`}
        className={TEXT_BUTTON_NEUTRAL}
      >
        {action}
      </button>
    ) : null}
  </div>
);

const EditorFrame = ({
  label,
  canRemove,
  isPending,
  isValid,
  onRemove,
  onCancel,
  onSubmit,
  children,
}: {
  label: string;
  canRemove: boolean;
  isPending: boolean;
  isValid: boolean;
  onRemove: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) => (
  <form
    className="flex flex-col gap-3 py-3"
    onSubmit={(event: FormEvent) => {
      event.preventDefault();
      if (isValid) onSubmit();
    }}
  >
    <div className="flex items-center justify-between">
      <span className={ROW_LABEL}>{label}</span>
      {canRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={isPending}
          className={TEXT_BUTTON_DANGER}
        >
          Remove limit
        </button>
      ) : null}
    </div>
    {children}
    <p className={FIELD_HINT}>{STORED_HINT}</p>
    <div className="flex justify-end gap-2">
      <Button label="Cancel" onClick={onCancel} disabled={isPending} />
      <Button
        type="submit"
        variant="filled"
        colorScheme="brand"
        label="Save"
        isLoading={isPending}
        disabled={!isValid}
      />
    </div>
  </form>
);

const ConcurrencyEditor = ({
  queueName,
  current,
  onDone,
}: {
  queueName: string;
  current: Limits["concurrency"];
  onDone: () => void;
}) => {
  const inputId = useId();
  const [value, setValue] = useState(String(current ?? 10));
  const save = trpc.queue.setConcurrency.useMutation(
    mutationToasts("Concurrency limit saved", {
      errorMessage: "Could not save the concurrency limit",
      onSuccess: onDone,
    }),
  );
  const concurrency = parseLimit(value);

  return (
    <EditorFrame
      label="Concurrency"
      canRemove={current !== null}
      isPending={save.isPending}
      isValid={concurrency !== null}
      onRemove={() => save.mutate({ queueName, concurrency: null })}
      onCancel={onDone}
      onSubmit={() => {
        if (concurrency !== null) save.mutate({ queueName, concurrency });
      }}
    >
      <div className="flex items-center gap-2 text-[13px] text-gray-700 dark:text-slate-300">
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_LIMIT}
          step={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label="Jobs at once"
          className={NUMBER_INPUT}
        />
        <label htmlFor={inputId}>jobs at once, across every worker</label>
      </div>
    </EditorFrame>
  );
};

const RateLimitEditor = ({
  queueName,
  current,
  onDone,
}: {
  queueName: string;
  current: Limits["rateLimit"];
  onDone: () => void;
}) => {
  const inputId = useId();
  const [value, setValue] = useState(String(current?.max ?? 100));
  const [duration, setDuration] = useState(String(current?.duration ?? 60_000));
  const save = trpc.queue.setRateLimit.useMutation(
    mutationToasts("Rate limit saved", {
      errorMessage: "Could not save the rate limit",
      onSuccess: onDone,
    }),
  );
  const max = parseLimit(value);
  // A window set elsewhere stays pickable, under its own name.
  const options: SelectOption<string>[] = [
    ...WINDOWS.map((window) => ({
      label: window.label,
      value: String(window.ms),
    })),
    ...(current && !WINDOWS.some((window) => window.ms === current.duration)
      ? [
          {
            label: formatDuration(current.duration),
            value: String(current.duration),
          },
        ]
      : []),
  ];

  return (
    <EditorFrame
      label="Rate limit"
      canRemove={current !== null}
      isPending={save.isPending}
      isValid={max !== null}
      onRemove={() => save.mutate({ queueName, limit: null })}
      onCancel={onDone}
      onSubmit={() => {
        if (max !== null) {
          save.mutate({
            queueName,
            limit: { max, duration: Number(duration) },
          });
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-gray-700 dark:text-slate-300">
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_LIMIT}
          step={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label="Jobs per window"
          className={NUMBER_INPUT}
        />
        <label htmlFor={inputId}>jobs per</label>
        <Select
          ariaLabel="Rate limit window"
          options={options}
          value={duration}
          onChange={setDuration}
        />
      </div>
    </EditorFrame>
  );
};
