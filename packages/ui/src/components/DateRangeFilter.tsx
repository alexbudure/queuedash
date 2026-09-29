import { clsx } from "clsx";
import { Calendar, Check, ChevronDown, X } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
  Popover,
  Radio,
  RadioGroup,
} from "react-aria-components";

import {
  type DateRange,
  formatDateRangeLabel,
  formatStatusJobCount,
  fromLocalInputValue,
  getDateRangePresets,
  getDateRangeTitle,
  getLocalTimeZoneName,
  hasDateRange,
  isSameDateRange,
  resolveRangeBound,
  toDateRangeInput,
  toLocalInputValue,
} from "../utils/dateRange";
import {
  FIELD_ERROR,
  FIELD_HINT,
  FOCUS_FIELD,
  FOCUS_RING,
  FOCUS_RING_DATA,
  OVERLAY_SURFACE,
  SECTION_LABEL,
  TEXT_MUTED,
} from "../utils/styles";
import type { RouterInput, Status } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { getStatusDisplayName } from "../utils/viewState";
import { Button } from "./Button";
import { useQueuedash } from "./QueuedashProvider";

/** The list the range narrows, minus paging, sort and the range itself. */
export type DateRangeCountInput = Pick<
  RouterInput["job"]["list"],
  "queueName" | "status" | "groupId" | "query" | "error" | "name"
>;

type DateRangeFilterProps = {
  status: Status;
  range: DateRange;
  onChange: (range: DateRange) => void;
  isDisabled?: boolean;
  /** What the phone sheet counts its choice against. */
  countInput: DateRangeCountInput;
};

const HOUR = 60 * 60_000;

/**
 * The custom range's fields, in the browser's local time. A range the list
 * already has seeds them, a relative one as the moments it covers right now;
 * with none they start at the last hour, a window worth adjusting.
 */
const useRangeFields = (range: DateRange) => {
  const [initial] = useState(() => {
    const now = Date.now();
    const from = range.from ? resolveRangeBound(range.from, now) : undefined;
    const to = range.to ? resolveRangeBound(range.to, now) : undefined;
    const minute = Math.floor(now / 60_000) * 60_000;
    return hasDateRange(range)
      ? {
          from: from === undefined ? "" : toLocalInputValue(from),
          to: to === undefined ? "" : toLocalInputValue(to),
        }
      : {
          from: toLocalInputValue(minute - HOUR),
          to: toLocalInputValue(minute),
        };
  });
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const fromMs = fromLocalInputValue(from);
  const toMs = fromLocalInputValue(to);
  const error =
    fromMs !== undefined && toMs !== undefined && fromMs > toMs
      ? "The start has to come before the end."
      : null;
  const value: DateRange = {
    from: fromMs === undefined ? undefined : { at: fromMs },
    to: toMs === undefined ? undefined : { at: toMs },
  };
  return { from, to, setFrom, setTo, error, value };
};

// `color-scheme` gives the native picker and its calendar glyph the theme.
const DATE_INPUT_CLASS =
  "min-w-0 font-mono text-[13px] tabular-nums text-gray-900 [color-scheme:light] dark:text-white dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-50 hover:[&::-webkit-calendar-picker-indicator]:opacity-80";

export const DateRangeFilter = ({
  status,
  range,
  onChange,
  isDisabled = false,
  countInput,
}: DateRangeFilterProps) => {
  const label = formatDateRangeLabel(range);
  const isActive = hasDateRange(range);

  return (
    <>
      <div className="shrink-0 max-sm:hidden">
        <DesktopDateRange
          status={status}
          range={range}
          label={label}
          isActive={isActive}
          isDisabled={isDisabled}
          onChange={onChange}
        />
      </div>
      <div className="shrink-0 sm:hidden">
        <PhoneDateRange
          status={status}
          range={range}
          label={label}
          isActive={isActive}
          isDisabled={isDisabled}
          onChange={onChange}
          countInput={countInput}
        />
      </div>
    </>
  );
};

type TriggerProps = {
  status: Status;
  range: DateRange;
  label: string;
  isActive: boolean;
  isDisabled: boolean;
  onChange: (range: DateRange) => void;
};

const DesktopDateRange = ({
  status,
  range,
  label,
  isActive,
  isDisabled,
  onChange,
}: TriggerProps) => {
  const { portalContainer } = useQueuedash();
  const [isOpen, setIsOpen] = useState(false);
  // The popover lines up with the whole chip, clear button included.
  const chipRef = useRef<HTMLSpanElement>(null);

  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
      {isActive ? (
        <span
          ref={chipRef}
          className="inline-flex h-9 max-w-full min-w-0 items-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-brand-200 ring-inset dark:bg-brand-950/50 dark:text-brand-300 dark:ring-brand-800/80"
        >
          <AriaButton
            isDisabled={isDisabled}
            aria-label={`Date range: ${label}`}
            className={clsx(
              "inline-flex h-full min-w-0 items-center gap-2 rounded-l-lg pr-1 pl-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 hover:bg-brand-100/70 disabled:opacity-50 dark:hover:bg-brand-950",
              FOCUS_RING_DATA,
            )}
          >
            <Calendar aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{label}</span>
          </AriaButton>
          <button
            type="button"
            disabled={isDisabled}
            onClick={() => onChange({})}
            aria-label="Clear the date range"
            className={clsx(
              "grid h-full w-7 shrink-0 place-items-center rounded-r-lg opacity-70 transition duration-150 hover:bg-brand-100/70 hover:opacity-100 disabled:opacity-40 dark:hover:bg-brand-950",
              FOCUS_RING,
            )}
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </span>
      ) : (
        <AriaButton
          isDisabled={isDisabled}
          aria-label={`Date range: ${label}`}
          className={clsx(
            // The filled Select's skin, so it reads as the sort control's twin.
            "group inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-gray-100 pr-2.5 pl-3 text-sm font-medium whitespace-nowrap text-gray-900 transition-colors duration-150 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 data-[pressed]:bg-gray-300/70 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700 dark:data-[pressed]:bg-slate-600",
            FOCUS_RING_DATA,
          )}
        >
          <Calendar
            aria-hidden="true"
            className="size-4 text-gray-500 dark:text-slate-400"
          />
          {label}
          <ChevronDown
            aria-hidden="true"
            className="size-3.5 text-gray-500 transition-transform duration-150 group-aria-[expanded=true]:rotate-180 dark:text-slate-400"
          />
        </AriaButton>
      )}
      <Popover
        UNSTABLE_portalContainer={portalContainer ?? undefined}
        triggerRef={isActive ? chipRef : undefined}
        placement="bottom end"
        offset={8}
        className={clsx(
          "qd-popover w-[19.5rem] max-w-[calc(100vw-2rem)] overflow-hidden outline-none",
          OVERLAY_SURFACE,
        )}
      >
        <Dialog
          aria-label={getDateRangeTitle(status)}
          className="outline-none"
          data-own-shortcuts=""
        >
          <DesktopDateRangePanel
            status={status}
            range={range}
            onChange={(next) => {
              onChange(next);
              setIsOpen(false);
            }}
          />
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
};

const DesktopDateRangePanel = ({
  status,
  range,
  onChange,
}: {
  status: Status;
  range: DateRange;
  onChange: (range: DateRange) => void;
}) => {
  const fields = useRangeFields(range);
  const fromId = useId();
  const toId = useId();
  const options = [
    { id: "any", label: "Any time", range: {} },
    ...getDateRangePresets(status),
  ];

  const apply = (event: FormEvent) => {
    event.preventDefault();
    if (fields.error) return;
    onChange(fields.value);
  };

  return (
    <form onSubmit={apply}>
      <p className={clsx(SECTION_LABEL, "px-3.5 pt-3 pb-1")}>
        {getDateRangeTitle(status)}
      </p>
      <div className="flex flex-col px-1.5 pt-0.5 pb-2">
        {options.map((option) => {
          const isSelected = isSameDateRange(option.range, range);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onChange(option.range)}
              className={clsx(
                "flex h-[34px] w-full items-center justify-between rounded-lg px-2.5 text-left text-sm transition-colors duration-150 hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-slate-700/60 dark:active:bg-slate-700",
                isSelected
                  ? "font-medium text-gray-900 dark:text-white"
                  : "text-gray-700 dark:text-slate-300",
                FOCUS_RING,
              )}
            >
              {option.label}
              {isSelected ? (
                <Check
                  aria-hidden="true"
                  className="size-4 text-brand-600 dark:text-brand-300"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="flex flex-col gap-2.5 border-t border-gray-100 px-3.5 pt-3 pb-3.5 dark:border-white/10">
        <p className={SECTION_LABEL}>Between</p>
        <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2">
          <label htmlFor={fromId} className={FIELD_HINT}>
            From
          </label>
          <input
            id={fromId}
            type="datetime-local"
            step={1}
            value={fields.from}
            onChange={(event) => fields.setFrom(event.target.value)}
            className={clsx(
              "h-[34px] w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 transition-colors hover:border-gray-300 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-slate-600",
              DATE_INPUT_CLASS,
              FOCUS_FIELD,
            )}
          />
          <label htmlFor={toId} className={FIELD_HINT}>
            To
          </label>
          <input
            id={toId}
            type="datetime-local"
            step={1}
            value={fields.to}
            onChange={(event) => fields.setTo(event.target.value)}
            aria-invalid={fields.error ? true : undefined}
            className={clsx(
              "h-[34px] w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 transition-colors hover:border-gray-300 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-slate-600",
              DATE_INPUT_CLASS,
              FOCUS_FIELD,
            )}
          />
        </div>
        <p className={fields.error ? FIELD_ERROR : FIELD_HINT} role="status">
          {fields.error ?? `Your time zone (${getLocalTimeZoneName()}).`}
        </p>
      </div>
      <div className="flex justify-end gap-2 border-t border-gray-100 bg-gray-50/60 px-3.5 py-2.5 dark:border-white/10 dark:bg-slate-900/40">
        <Button label="Clear" onClick={() => onChange({})} />
        <Button
          type="submit"
          variant="filled"
          colorScheme="brand"
          label="Apply"
          disabled={Boolean(fields.error)}
        />
      </div>
    </form>
  );
};

const BETWEEN = "between";
const ANY_TIME = "any";

const PhoneDateRange = ({
  status,
  range,
  label,
  isActive,
  isDisabled,
  onChange,
  countInput,
}: TriggerProps & { countInput: DateRangeCountInput }) => {
  const { portalContainer } = useQueuedash();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={isDisabled}
        onClick={() => setIsOpen(true)}
        aria-label={`Date range: ${label}`}
        aria-haspopup="dialog"
        className={clsx(
          "grid size-11 shrink-0 place-items-center rounded-[10px] transition-colors duration-150 disabled:opacity-50",
          isActive
            ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200 ring-inset dark:bg-brand-950/50 dark:text-brand-300 dark:ring-brand-800/80"
            : "bg-gray-100 text-gray-700 active:bg-gray-200 dark:bg-slate-800 dark:text-slate-200 dark:active:bg-slate-700",
          FOCUS_RING,
        )}
      >
        <Calendar aria-hidden="true" className="size-[18px]" />
      </button>
      <ModalOverlay
        UNSTABLE_portalContainer={portalContainer ?? undefined}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        isDismissable
        className="qd-sheet-overlay fixed inset-0 z-50"
      >
        <Modal className="qd-sheet fixed inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-[18px] bg-white px-4 pt-2 pb-[calc(1.75rem+env(safe-area-inset-bottom,0px))] shadow-[0_-10px_30px_-12px_rgb(16_18_21/0.3)] dark:bg-slate-900 dark:shadow-black/80">
          <Dialog className="outline-none" data-own-shortcuts="">
            <PhoneDateRangeSheet
              status={status}
              range={range}
              countInput={countInput}
              onApply={(next) => {
                onChange(next);
                setIsOpen(false);
              }}
            />
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  );
};

const PhoneDateRangeSheet = ({
  status,
  range,
  countInput,
  onApply,
}: {
  status: Status;
  range: DateRange;
  countInput: DateRangeCountInput;
  onApply: (range: DateRange) => void;
}) => {
  const presets = getDateRangePresets(status);
  const fields = useRangeFields(range);
  const [choice, setChoice] = useState(
    () =>
      (hasDateRange(range)
        ? presets.find((preset) => isSameDateRange(preset.range, range))?.id
        : ANY_TIME) ?? BETWEEN,
  );
  const pending: DateRange =
    choice === BETWEEN
      ? fields.value
      : (presets.find((preset) => preset.id === choice)?.range ?? {});
  const isInvalid = choice === BETWEEN && Boolean(fields.error);

  // What the button will show, counted before it is pressed. Exact and cheap
  // for the finished jobs BullMQ and Bull keep sorted by finish time; anything
  // else is the usual bounded scan.
  const count = trpc.job.list.useQuery(
    {
      ...countInput,
      ...toDateRangeInput(pending),
      limit: 1,
      sort: "queue",
    },
    { enabled: !isInvalid, retry: false },
  );
  const statusName = getStatusDisplayName(status);
  const total = count.data?.totalCount;
  const isCapped = count.data?.searchMeta?.capped === true;
  const applyLabel =
    total === undefined || count.isFetching || isInvalid
      ? `Show ${statusName} jobs`
      : `Show ${isCapped ? "at least " : ""}${formatStatusJobCount(total, status)}`;

  const options = [
    { id: ANY_TIME, label: "Any time" },
    ...presets.map(({ id, label }) => ({ id, label })),
    { id: BETWEEN, label: "Between" },
  ];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!isInvalid) onApply(pending);
      }}
    >
      <div
        aria-hidden="true"
        className="mx-auto h-1 w-9 rounded-full bg-gray-300 dark:bg-slate-700"
      />
      <div className="mt-3.5 flex items-center justify-between">
        <Heading
          slot="title"
          className="text-[17px] leading-6 font-semibold text-gray-900 dark:text-white"
        >
          {getDateRangeTitle(status)}
        </Heading>
        <button
          type="button"
          onClick={() => setChoice(ANY_TIME)}
          className={clsx(
            "h-11 rounded-md px-1 text-[15px] font-medium text-brand-600 dark:text-brand-300",
            FOCUS_RING,
          )}
        >
          Clear
        </button>
      </div>
      <RadioGroup
        aria-label={getDateRangeTitle(status)}
        value={choice}
        onChange={setChoice}
        className="mt-1.5"
      >
        {options.map((option) => (
          <Radio
            key={option.id}
            value={option.id}
            className={clsx(
              "group flex h-12 cursor-pointer items-center gap-3 border-t border-gray-100 px-1 text-base text-gray-900 dark:border-slate-800 dark:text-white",
              FOCUS_RING_DATA,
            )}
          >
            <span
              aria-hidden="true"
              className="grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] border-gray-300 group-data-[selected]:border-brand-600 dark:border-slate-600 dark:group-data-[selected]:border-brand-500"
            >
              <span className="size-2.5 rounded-full bg-brand-600 opacity-0 group-data-[selected]:opacity-100 dark:bg-brand-500" />
            </span>
            {option.label}
          </Radio>
        ))}
      </RadioGroup>
      {choice === BETWEEN ? (
        <div className="flex flex-col gap-2 py-1 pl-9">
          {(
            [
              ["From", fields.from, fields.setFrom],
              ["To", fields.to, fields.setTo],
            ] as const
          ).map(([fieldLabel, value, setValue]) => (
            <label
              key={fieldLabel}
              className="flex h-12 items-center justify-between gap-3 rounded-[10px] border border-gray-200 bg-gray-50 px-3.5 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-700 dark:bg-slate-950 dark:focus-within:border-brand-600 dark:focus-within:ring-brand-950"
            >
              <span className={clsx("text-sm", TEXT_MUTED)}>{fieldLabel}</span>
              <input
                type="datetime-local"
                step={1}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                className={clsx(
                  "flex-1 bg-transparent text-right text-sm outline-none",
                  DATE_INPUT_CLASS,
                )}
              />
            </label>
          ))}
          <p
            role="status"
            className={clsx("mt-0.5", fields.error ? FIELD_ERROR : FIELD_HINT)}
          >
            {fields.error ?? `Your time zone (${getLocalTimeZoneName()}).`}
          </p>
        </div>
      ) : null}
      <button
        type="submit"
        disabled={isInvalid}
        className={clsx(
          "mt-4 flex h-[50px] w-full items-center justify-center rounded-full bg-brand-600 text-base font-semibold text-white transition-colors duration-150 active:bg-brand-700 disabled:opacity-50 dark:active:bg-brand-500",
          FOCUS_RING,
        )}
      >
        {applyLabel}
      </button>
    </form>
  );
};
