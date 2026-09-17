import { clsx } from "clsx";
import cronstrue from "cronstrue";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button as AriaButton,
  ComboBox,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
} from "react-aria-components";
import { toast } from "sonner";

import { formatCountLabel } from "../utils/format";
import type { JSONEditorValidationState } from "../utils/jsonEditor";
import { normalizeJSONEditorValue } from "../utils/jsonEditor";
import { mutationToasts } from "../utils/mutationToasts";
import {
  FIELD_ERROR,
  FIELD_HINT,
  FIELD_LABEL,
  FOCUS_FIELD,
  FOCUS_RING,
  FOCUS_RING_DATA,
  INPUT_CLASS,
  OVERLAY_ITEM,
  OVERLAY_SURFACE,
  SECTION_LABEL,
  TEXT_MUTED,
} from "../utils/styles";
import type { Queue, Scheduler } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import {
  getInitialSchedulerTimezone,
  getSchedulerScheduleError,
  getSchedulerTimezoneInput,
  getSchedulerTimezoneOptions,
} from "../utils/viewState";
import { Button } from "./Button";
import { JSONEditor } from "./JSONEditor";
import { useQueuedash } from "./QueuedashProvider";
import { SidePanelDialog } from "./SidePanelDialog";

type JobModalProps = {
  queue: Queue;
  onDismiss: () => void;
  onSuccess?: () => void;
  scheduler?: Scheduler;
  variant?: "job" | "scheduler";
};

const JSON_HELPER_TEXT =
  "Accepts JSON and safe JS object-literal syntax. Unquoted keys, single quotes, and trailing commas normalize on blur.";

const SCHEDULE_HINT =
  "Provide exactly one: a cron pattern or an interval in milliseconds.";

/**
 * The backend's own defaults, made explicit so the three options people
 * actually reach for are already in the editor instead of an empty `{}`.
 * `attempts: 1` means the backoff never fires until it is raised, so this is
 * the same behaviour an empty object produced.
 */
const DEFAULT_JOB_OPTIONS = JSON.stringify(
  {
    attempts: 1,
    backoff: { type: "exponential", delay: 1000 },
    delay: 0,
  },
  null,
  2,
);

const EMPTY_OPTIONS = "{}";

const DEFAULT_OPTIONS_SUMMARY = "Default options";

const NO_TIMEZONE_KEY = "__no-timezone__";

const TIMEZONES = Intl.supportedValuesOf("timeZone");

type TimezoneItem = { id: string; label: string };

/** Re-serializes an options field so two spellings of the same object compare
 *  equal. `null` means the field does not currently parse. */
const normalizeOptionsValue = (value: string) => {
  const state = normalizeJSONEditorValue({
    value,
    label: "Options",
    rootType: "object",
  });

  if (!state.isValid) {
    return null;
  }

  return state.normalizedValue ?? EMPTY_OPTIONS;
};

const countOptionKeys = (normalizedValue: string) =>
  Object.keys(JSON.parse(normalizedValue) as Record<string, unknown>).length;

/**
 * What the collapsed Advanced summary says, e.g. "Default options" or
 * "3 options set".
 *
 * "Default" is measured against the backend defaults, never against the values
 * the panel opened with: on the edit path those *are* the scheduler's existing
 * configuration, and calling that "default" would collapse it out of sight.
 */
const describeAdvancedOptions = (
  templateOptions: string,
  schedulerOptions: string,
) => {
  const normalizedTemplateOptions = normalizeOptionsValue(templateOptions);
  const normalizedSchedulerOptions = normalizeOptionsValue(schedulerOptions);

  if (
    normalizedTemplateOptions === null ||
    normalizedSchedulerOptions === null
  ) {
    return "Options need attention";
  }

  if (
    (normalizedTemplateOptions === EMPTY_OPTIONS ||
      normalizedTemplateOptions === DEFAULT_JOB_OPTIONS) &&
    normalizedSchedulerOptions === EMPTY_OPTIONS
  ) {
    return DEFAULT_OPTIONS_SUMMARY;
  }

  const count =
    countOptionKeys(normalizedTemplateOptions) +
    countOptionKeys(normalizedSchedulerOptions);

  return `${formatCountLabel(count, "option")} set`;
};

const SectionHeader = ({
  children,
  description,
}: {
  children: ReactNode;
  description?: string;
}) => (
  <div className="border-t border-gray-100 pt-5 dark:border-slate-800/60">
    <h3 className={clsx(description ? "mb-1.5" : "mb-4", SECTION_LABEL)}>
      {children}
    </h3>
    {description ? (
      <p className={clsx("mb-4", FIELD_HINT)}>{description}</p>
    ) : null}
  </div>
);

/**
 * The two optional JSON editors, folded away behind one row. Mounting three
 * Monaco instances put two code editors between "Add scheduler" and the cron
 * field, and on the create path one of them is editing an empty object.
 */
const AdvancedOptions = ({
  children,
  isOpen,
  onToggle,
  summary,
}: {
  children: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  summary: string;
}) => {
  const contentId = useId();

  return (
    <div className="border-t border-gray-100 pt-5 dark:border-slate-800/60">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={isOpen ? contentId : undefined}
        className={clsx(
          "flex w-full items-center justify-between gap-3 rounded-lg px-1.5 py-1.5 text-left transition-colors duration-150 hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-slate-800/60 dark:active:bg-slate-800",
          FOCUS_RING,
        )}
      >
        <span className="flex items-center gap-1.5">
          <ChevronRight
            aria-hidden="true"
            className={clsx(
              "size-3.5 text-gray-400 transition-transform duration-150 dark:text-slate-500",
              isOpen && "rotate-90",
            )}
          />
          <span className={SECTION_LABEL}>Advanced</span>
        </span>
        <span className={clsx("truncate text-xs", TEXT_MUTED)}>{summary}</span>
      </button>

      {isOpen ? (
        <div id={contentId} className="mt-4 space-y-5">
          {children}
        </div>
      ) : null}
    </div>
  );
};

const getInitialValidationState = (
  value: string,
  label: string,
  required = false,
) => {
  return normalizeJSONEditorValue({
    value,
    label,
    required,
    rootType: "object",
  });
};

const getCronPatternError = (pattern: string) => {
  const trimmedPattern = pattern.trim();

  if (!trimmedPattern) {
    return null;
  }

  try {
    cronstrue.toString(trimmedPattern, { verbose: true });
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/^Error:\s*/, "") || "Cron pattern is not valid.";
  }
};

const getCronDescription = (pattern: string) => {
  const trimmedPattern = pattern.trim();

  if (!trimmedPattern) {
    return null;
  }

  try {
    return cronstrue.toString(trimmedPattern, { verbose: true });
  } catch {
    return null;
  }
};

const getInitialFormValues = (scheduler: Scheduler | undefined) => ({
  dataValue: "{}",
  optsValue: DEFAULT_JOB_OPTIONS,
  schedulerName: scheduler?.name ?? "manual-scheduler",
  templateDataValue: JSON.stringify(
    scheduler?.template?.data ??
      (scheduler ? {} : { message: "Scheduled from Queuedash" }),
    null,
    2,
  ),
  templateOptsValue: scheduler
    ? JSON.stringify(scheduler.template?.opts ?? {}, null, 2)
    : DEFAULT_JOB_OPTIONS,
  patternValue: scheduler?.pattern ?? (scheduler ? "" : "0 * * * *"),
  everyValue: scheduler?.every ? String(scheduler.every) : "",
  timezoneValue: getInitialSchedulerTimezone({
    browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    isEditing: !!scheduler,
    schedulerTimezone: scheduler?.tz,
  }),
  schedulerOptionsValue: JSON.stringify(
    {
      limit: scheduler?.limit,
      startDate: scheduler?.startDate,
      endDate: scheduler?.endDate,
      offset: scheduler?.offset,
    },
    null,
    2,
  ),
});

/**
 * All of the Add job / Add scheduler form state, kept in a hook so the fields
 * and the pinned footer can live on opposite sides of `SidePanelDialog`, and so
 * SchedulerModal can swap the form in without unmounting its dialog.
 */
export const useJobForm = ({
  queue,
  onDismiss,
  onSuccess,
  scheduler,
  variant = "job",
}: JobModalProps) => {
  const schedulerScheduleDescriptionId = useId();
  const schedulerEveryId = useId();
  const schedulerNameId = useId();
  const schedulerPatternId = useId();

  const formRef = useRef<HTMLFormElement | null>(null);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

  const isJob = variant === "job";
  const supportsJobOptions = queue.supports.addJobOptions;
  const isEditingScheduler = !isJob && !!scheduler;

  const { mutate: addJob, status: addJobStatus } =
    trpc.queue.addJob.useMutation(
      mutationToasts("Job added", {
        errorMessage: "Could not add the job. Please try again.",
        onSuccess: () => {
          onSuccess?.();
          onDismiss();
        },
      }),
    );

  const { mutate: addJobScheduler, status: addSchedulerStatus } =
    trpc.queue.addJobScheduler.useMutation(
      mutationToasts("Scheduler added", {
        errorMessage: "Could not add the scheduler. Please try again.",
        onSuccess: () => {
          onSuccess?.();
          onDismiss();
        },
      }),
    );

  const { mutate: updateJobScheduler, status: updateSchedulerStatus } =
    trpc.scheduler.update.useMutation(
      mutationToasts("Scheduler updated", {
        errorMessage: "Could not update the scheduler. Please try again.",
        onSuccess: () => {
          onSuccess?.();
          onDismiss();
        },
      }),
    );

  // Dirtiness is measured against what the panel opened with - a literal "{}"
  // comparison would report every freshly-opened scheduler panel as dirty.
  const [initialValues] = useState(() => getInitialFormValues(scheduler));

  const [showErrors, setShowErrors] = useState(false);
  const [isPatternTouched, setIsPatternTouched] = useState(false);

  const [dataValue, setDataValue] = useState(initialValues.dataValue);
  const [optsValue, setOptsValue] = useState(initialValues.optsValue);
  const [jobDataValidation, setJobDataValidation] =
    useState<JSONEditorValidationState>(() =>
      getInitialValidationState(initialValues.dataValue, "Data", true),
    );
  const [jobOptsValidation, setJobOptsValidation] =
    useState<JSONEditorValidationState>(() =>
      getInitialValidationState(initialValues.optsValue, "Options"),
    );

  const [schedulerName, setSchedulerName] = useState(
    initialValues.schedulerName,
  );
  const [templateDataValue, setTemplateDataValue] = useState(
    initialValues.templateDataValue,
  );
  const [templateOptsValue, setTemplateOptsValue] = useState(
    initialValues.templateOptsValue,
  );
  const [patternValue, setPatternValue] = useState(initialValues.patternValue);
  const [everyValue, setEveryValue] = useState(initialValues.everyValue);
  const [timezoneValue, setTimezoneValue] = useState(
    initialValues.timezoneValue,
  );
  const [schedulerOptionsValue, setSchedulerOptionsValue] = useState(
    initialValues.schedulerOptionsValue,
  );
  const [templateDataValidation, setTemplateDataValidation] =
    useState<JSONEditorValidationState>(() =>
      getInitialValidationState(
        initialValues.templateDataValue,
        "Template data",
        true,
      ),
    );
  const [templateOptsValidation, setTemplateOptsValidation] =
    useState<JSONEditorValidationState>(() =>
      getInitialValidationState(
        initialValues.templateOptsValue,
        "Template options",
      ),
    );
  const [schedulerOptionsValidation, setSchedulerOptionsValidation] =
    useState<JSONEditorValidationState>(() =>
      getInitialValidationState(
        initialValues.schedulerOptionsValue,
        "Scheduler options",
      ),
    );

  // Anything the panel opens with that is not a backend default is already
  // configuration someone wrote, so the disclosure starts open rather than
  // hiding it one click deep.
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(
    () =>
      describeAdvancedOptions(
        initialValues.templateOptsValue,
        initialValues.schedulerOptionsValue,
      ) !== DEFAULT_OPTIONS_SUMMARY,
  );

  const advancedSummary = useMemo(
    () => describeAdvancedOptions(templateOptsValue, schedulerOptionsValue),
    [schedulerOptionsValue, templateOptsValue],
  );

  const status = isJob
    ? addJobStatus
    : isEditingScheduler
      ? updateSchedulerStatus
      : addSchedulerStatus;

  const structuralScheduleError = useMemo(
    () => getSchedulerScheduleError(patternValue, everyValue),
    [everyValue, patternValue],
  );
  const cronPatternError = useMemo(
    () => getCronPatternError(patternValue),
    [patternValue],
  );
  const cronDescription = useMemo(
    () => getCronDescription(patternValue),
    [patternValue],
  );
  // The either/or rule is an instruction, so it reads immediately. A malformed
  // cron pattern is only a mistake once the field has been left.
  const visibleScheduleError =
    structuralScheduleError ??
    (isPatternTouched || showErrors ? cronPatternError : null);

  const timezoneItems = useMemo<TimezoneItem[]>(
    () => [
      { id: NO_TIMEZONE_KEY, label: "No timezone override" },
      ...getSchedulerTimezoneOptions(
        TIMEZONES,
        initialValues.timezoneValue,
      ).map((timezone) => ({ id: timezone, label: timezone })),
    ],
    [initialValues.timezoneValue],
  );

  // The button only goes dead for problems the form is currently showing.
  // Half-typed JSON and an untouched cron pattern are invalid from the first
  // keystroke but silent until blur or a submit attempt, and a disabled button
  // next to no message is unexplainable - `handleSubmit` reveals every message
  // and scrolls to the offending field, which is strictly better feedback.
  const hasVisibleJSONErrors =
    showErrors &&
    (isJob
      ? !jobDataValidation.isValid ||
        (supportsJobOptions && !jobOptsValidation.isValid)
      : !templateDataValidation.isValid ||
        !templateOptsValidation.isValid ||
        !schedulerOptionsValidation.isValid);
  const isFormInvalid =
    hasVisibleJSONErrors || (!isJob && !!visibleScheduleError);

  const isDirty = isJob
    ? dataValue !== initialValues.dataValue ||
      optsValue !== initialValues.optsValue
    : schedulerName !== initialValues.schedulerName ||
      templateDataValue !== initialValues.templateDataValue ||
      templateOptsValue !== initialValues.templateOptsValue ||
      patternValue !== initialValues.patternValue ||
      everyValue !== initialValues.everyValue ||
      timezoneValue !== initialValues.timezoneValue ||
      schedulerOptionsValue !== initialValues.schedulerOptionsValue;

  const registerField = (key: string) => (node: HTMLElement | null) => {
    fieldRefs.current[key] = node;
  };

  const focusField = (key: string) => {
    const node = fieldRefs.current[key];

    if (!node) {
      return;
    }

    node.scrollIntoView({ block: "center" });

    const focusable =
      node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
        ? node
        : node.querySelector<HTMLElement>("textarea, input");

    focusable?.focus();
  };

  // An editor inside a collapsed Advanced section is unmounted, so its ref is
  // null until the section has rendered.
  const revealAdvancedField = (key: string) => {
    setIsAdvancedOpen(true);
    requestAnimationFrame(() => focusField(key));
  };

  const normalizeObjectField = ({
    value,
    label,
    required = false,
    setValue,
    setValidation,
  }: {
    value: string;
    label: string;
    required?: boolean;
    setValue: (value: string) => void;
    setValidation: (state: JSONEditorValidationState) => void;
  }) => {
    const validationState = normalizeJSONEditorValue({
      value,
      label,
      required,
      rootType: "object",
    });

    setValidation(validationState);

    if (
      validationState.normalizedValue !== undefined &&
      validationState.normalizedValue !== value
    ) {
      setValue(validationState.normalizedValue);
    }

    return validationState;
  };

  const onAddJob = () => {
    const normalizedData = normalizeObjectField({
      value: dataValue,
      label: "Data",
      required: true,
      setValue: setDataValue,
      setValidation: setJobDataValidation,
    });
    const normalizedOpts = supportsJobOptions
      ? normalizeObjectField({
          value: optsValue,
          label: "Options",
          setValue: setOptsValue,
          setValidation: setJobOptsValidation,
        })
      : null;

    if (!normalizedData.isValid) {
      focusField("data");
      return;
    }

    if (normalizedOpts?.isValid === false) {
      focusField("opts");
      return;
    }

    addJob({
      queueName: queue.name,
      data: normalizedData.parsedValue as Record<string, unknown>,
      opts: normalizedOpts?.parsedValue as Record<string, unknown> | undefined,
    });
  };

  const onAddScheduler = () => {
    const normalizedTemplateData = normalizeObjectField({
      value: templateDataValue,
      label: "Template data",
      required: true,
      setValue: setTemplateDataValue,
      setValidation: setTemplateDataValidation,
    });
    const normalizedTemplateOpts = normalizeObjectField({
      value: templateOptsValue,
      label: "Template options",
      setValue: setTemplateOptsValue,
      setValidation: setTemplateOptsValidation,
    });
    const normalizedSchedulerOpts = normalizeObjectField({
      value: schedulerOptionsValue,
      label: "Scheduler options",
      setValue: setSchedulerOptionsValue,
      setValidation: setSchedulerOptionsValidation,
    });
    const nextSchedulerScheduleError =
      getSchedulerScheduleError(patternValue, everyValue) ??
      getCronPatternError(patternValue);

    if (nextSchedulerScheduleError) {
      focusField("pattern");
      return;
    }

    if (!normalizedTemplateData.isValid) {
      focusField("templateData");
      return;
    }

    if (!normalizedTemplateOpts.isValid) {
      revealAdvancedField("templateOpts");
      return;
    }

    if (!normalizedSchedulerOpts.isValid) {
      revealAdvancedField("schedulerOptions");
      return;
    }

    const trimmedEvery = everyValue.trim();
    const parsedEvery = trimmedEvery ? Number(trimmedEvery) : undefined;
    const schedulerOpts =
      (normalizedSchedulerOpts.parsedValue as
        | Record<string, unknown>
        | undefined) || {};

    const input = {
      queueName: queue.name,
      template: {
        name: schedulerName.trim() || undefined,
        data: normalizedTemplateData.parsedValue as Record<string, unknown>,
        opts: normalizedTemplateOpts.parsedValue as
          | Record<string, unknown>
          | undefined,
      },
      opts: {
        ...schedulerOpts,
        pattern: patternValue.trim() || undefined,
        every: parsedEvery,
        tz: getSchedulerTimezoneInput(timezoneValue),
      },
    };

    if (isEditingScheduler) {
      updateJobScheduler({
        ...input,
        key: scheduler.key,
        opts: input.opts,
      });
    } else {
      addJobScheduler(input);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (status === "pending") {
      return;
    }

    setShowErrors(true);
    setIsPatternTouched(true);

    if (isJob) {
      onAddJob();
    } else {
      onAddScheduler();
    }
  };

  const submit = () => {
    formRef.current?.requestSubmit();
  };

  return {
    advancedSummary,
    cronDescription,
    dataValue,
    everyValue,
    focusField,
    formRef,
    handleSubmit,
    ids: {
      every: schedulerEveryId,
      name: schedulerNameId,
      pattern: schedulerPatternId,
      scheduleDescription: schedulerScheduleDescriptionId,
    },
    isAdvancedOpen,
    isDirty,
    isEditingScheduler,
    isFormInvalid,
    isJob,
    onDismiss,
    optsValue,
    patternValue,
    registerField,
    schedulerName,
    schedulerOptionsValue,
    setDataValue,
    setEveryValue,
    setIsPatternTouched,
    setJobDataValidation,
    setJobOptsValidation,
    setOptsValue,
    setPatternValue,
    setSchedulerName,
    setSchedulerOptionsValidation,
    setSchedulerOptionsValue,
    setTemplateDataValidation,
    setTemplateDataValue,
    setTemplateOptsValidation,
    setTemplateOptsValue,
    setTimezoneValue,
    showErrors,
    status,
    submit,
    submitLabel: isJob
      ? "Add job"
      : isEditingScheduler
        ? "Save changes"
        : "Add scheduler",
    supportsJobOptions,
    templateDataValue,
    templateOptsValue,
    timezoneItems,
    timezoneValue,
    title: isEditingScheduler
      ? "Edit scheduler"
      : `Add ${isJob ? "job" : "scheduler"}`,
    toggleAdvanced: () => setIsAdvancedOpen((current) => !current),
    visibleScheduleError,
  };
};

export type JobFormController = ReturnType<typeof useJobForm>;

export const SchedulerScheduleInputs = ({
  descriptionId,
  everyId,
  everyValue,
  onEveryValueChange,
  onPatternBlur,
  onPatternValueChange,
  patternId,
  patternRef,
  patternValue,
  scheduleError,
  scheduleHint,
}: {
  descriptionId: string;
  everyId: string;
  everyValue: string;
  onEveryValueChange: (value: string) => void;
  onPatternBlur: () => void;
  onPatternValueChange: (value: string) => void;
  patternId: string;
  patternRef?: (node: HTMLElement | null) => void;
  patternValue: string;
  scheduleError: string | null;
  scheduleHint: string;
}) => (
  <div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor={patternId} className={FIELD_LABEL}>
          Cron pattern
        </label>
        <input
          id={patternId}
          ref={patternRef}
          value={patternValue}
          onChange={(event) => onPatternValueChange(event.target.value)}
          onBlur={onPatternBlur}
          aria-describedby={descriptionId}
          aria-invalid={scheduleError ? true : undefined}
          className={clsx(INPUT_CLASS, FOCUS_FIELD, "font-mono text-xs")}
          placeholder="0 * * * *"
        />
      </div>

      <div>
        <label htmlFor={everyId} className={FIELD_LABEL}>
          Interval (ms)
        </label>
        <input
          id={everyId}
          inputMode="numeric"
          value={everyValue}
          onChange={(event) => onEveryValueChange(event.target.value)}
          aria-describedby={descriptionId}
          aria-invalid={scheduleError ? true : undefined}
          className={clsx(INPUT_CLASS, FOCUS_FIELD, "font-mono text-xs")}
          placeholder="60000"
        />
      </div>
    </div>

    <p
      id={descriptionId}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={clsx("mt-1.5", scheduleError ? FIELD_ERROR : FIELD_HINT)}
    >
      {scheduleError ?? scheduleHint}
    </p>
  </div>
);

const TimezoneField = ({
  items,
  onChange,
  value,
}: {
  items: TimezoneItem[];
  onChange: (value: string) => void;
  value: string;
}) => {
  const { portalContainer } = useQueuedash();

  return (
    <ComboBox
      defaultItems={items}
      selectedKey={value || NO_TIMEZONE_KEY}
      onSelectionChange={(key) => {
        onChange(key === null || key === NO_TIMEZONE_KEY ? "" : String(key));
      }}
      menuTrigger="focus"
      className="flex flex-col"
    >
      <Label className={FIELD_LABEL}>Timezone</Label>

      <div className="relative">
        {/* No `id` here: react-aria merges a local id over its generated one,
            which would leave the Label's `for` pointing at nothing. */}
        <Input
          placeholder="Search time zones…"
          className={clsx(INPUT_CLASS, FOCUS_FIELD, "pr-9 font-mono text-xs")}
        />
        <AriaButton
          className={clsx(
            "absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg text-gray-500 transition-colors duration-150 hover:text-gray-900 data-[pressed]:text-gray-900 dark:text-slate-400 dark:hover:text-white dark:data-[pressed]:text-white",
            FOCUS_RING_DATA,
          )}
        >
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </AriaButton>
      </div>

      <Popover
        UNSTABLE_portalContainer={portalContainer ?? undefined}
        offset={6}
        className={clsx(
          "qd-popover w-[var(--trigger-width)] p-1 outline-none",
          OVERLAY_SURFACE,
        )}
      >
        <ListBox
          className="qd-scroll qd-scroll-contain max-h-64 overflow-y-auto outline-none"
          renderEmptyState={() => (
            <p className={clsx("px-2.5 py-2 text-sm", TEXT_MUTED)}>
              No matching time zone
            </p>
          )}
        >
          {(item: TimezoneItem) => (
            <ListBoxItem
              id={item.id}
              textValue={item.label}
              className={({ isFocused, isHovered, isSelected, isPressed }) =>
                clsx(
                  OVERLAY_ITEM,
                  "justify-between gap-3 transition-colors duration-150",
                  isSelected
                    ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/50 dark:text-brand-300"
                    : "text-gray-700 dark:text-slate-300",
                  (isFocused || isHovered) &&
                    !isSelected &&
                    "bg-gray-50 dark:bg-slate-700/60",
                  isPressed && !isSelected && "bg-gray-100 dark:bg-slate-700",
                )
              }
            >
              {({ isSelected }) => (
                <>
                  <span className="truncate">{item.label}</span>
                  <Check
                    aria-hidden="true"
                    className={clsx(
                      "size-3.5 shrink-0",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                  />
                </>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </ComboBox>
  );
};

export const JobFormFields = ({ form }: { form: JobFormController }) => (
  <form
    ref={form.formRef}
    onSubmit={form.handleSubmit}
    noValidate
    className="space-y-5 p-6"
  >
    {form.isJob ? (
      <>
        {/* Said once for the whole form: it is the same rule in every editor. */}
        <p className={FIELD_HINT}>{JSON_HELPER_TEXT}</p>

        <div ref={form.registerField("data")}>
          <JSONEditor
            label="Data"
            value={form.dataValue}
            onChange={form.setDataValue}
            required
            autoFocus
            rootType="object"
            height="280px"
            showErrors={form.showErrors}
            onSubmit={form.submit}
            onValidationChange={form.setJobDataValidation}
          />
        </div>

        {form.supportsJobOptions ? (
          <div ref={form.registerField("opts")}>
            <JSONEditor
              label="Options"
              value={form.optsValue}
              onChange={form.setOptsValue}
              rootType="object"
              height="240px"
              showErrors={form.showErrors}
              onSubmit={form.submit}
              onValidationChange={form.setJobOptsValidation}
            />
          </div>
        ) : (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
            This queue accepts job data only; its adapter does not support job
            options.
          </p>
        )}
      </>
    ) : (
      <>
        <div>
          <label htmlFor={form.ids.name} className={FIELD_LABEL}>
            Scheduler name
          </label>
          <input
            id={form.ids.name}
            autoFocus
            value={form.schedulerName}
            onChange={(event) => form.setSchedulerName(event.target.value)}
            className={clsx(INPUT_CLASS, FOCUS_FIELD)}
            placeholder="manual-scheduler"
          />
        </div>

        <SectionHeader>Schedule</SectionHeader>

        <SchedulerScheduleInputs
          descriptionId={form.ids.scheduleDescription}
          everyId={form.ids.every}
          everyValue={form.everyValue}
          onEveryValueChange={form.setEveryValue}
          onPatternBlur={() => form.setIsPatternTouched(true)}
          onPatternValueChange={form.setPatternValue}
          patternId={form.ids.pattern}
          patternRef={form.registerField("pattern")}
          patternValue={form.patternValue}
          scheduleError={form.visibleScheduleError}
          scheduleHint={form.cronDescription ?? SCHEDULE_HINT}
        />

        <TimezoneField
          items={form.timezoneItems}
          onChange={form.setTimezoneValue}
          value={form.timezoneValue}
        />

        <SectionHeader description={JSON_HELPER_TEXT}>Template</SectionHeader>

        <div ref={form.registerField("templateData")}>
          <JSONEditor
            label="Template data"
            value={form.templateDataValue}
            onChange={form.setTemplateDataValue}
            required
            rootType="object"
            height="240px"
            showErrors={form.showErrors}
            onSubmit={form.submit}
            onValidationChange={form.setTemplateDataValidation}
          />
        </div>

        <AdvancedOptions
          isOpen={form.isAdvancedOpen}
          onToggle={form.toggleAdvanced}
          summary={form.advancedSummary}
        >
          <div ref={form.registerField("templateOpts")}>
            <JSONEditor
              label="Template options"
              value={form.templateOptsValue}
              onChange={form.setTemplateOptsValue}
              rootType="object"
              height="220px"
              showErrors={form.showErrors}
              onSubmit={form.submit}
              onValidationChange={form.setTemplateOptsValidation}
            />
          </div>

          <div ref={form.registerField("schedulerOptions")}>
            <JSONEditor
              label="Scheduler options"
              value={form.schedulerOptionsValue}
              onChange={form.setSchedulerOptionsValue}
              rootType="object"
              height="220px"
              showErrors={form.showErrors}
              onSubmit={form.submit}
              onValidationChange={form.setSchedulerOptionsValidation}
            />
          </div>
        </AdvancedOptions>
      </>
    )}

    {/* The visible primary lives in the pinned footer, outside this form, so a
        hidden default button is what makes Enter submit from a text field. */}
    <button type="submit" tabIndex={-1} aria-hidden="true" className="hidden" />
  </form>
);

export const JobFormFooter = ({
  form,
  onCancel,
}: {
  form: JobFormController;
  onCancel: () => void;
}) => (
  <div className="flex items-center justify-end gap-2 border-t border-gray-100/80 bg-gray-50/50 px-6 py-4 dark:border-slate-800/60 dark:bg-slate-900/30">
    <Button label="Cancel" size="lg" onClick={onCancel} />
    <Button
      label={form.submitLabel}
      size="lg"
      variant="filled"
      colorScheme="brand"
      isLoading={form.status === "pending"}
      disabled={form.isFormInvalid}
      onClick={form.submit}
    />
  </div>
);

export const AddJobModal = ({
  queue,
  onDismiss,
  onSuccess,
  scheduler,
  variant = "job",
}: JobModalProps) => {
  const form = useJobForm({ queue, onDismiss, onSuccess, scheduler, variant });

  return (
    <SidePanelDialog
      title={form.title}
      subtitle={queue.displayName}
      open={true}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onDismiss();
        }
      }}
      isDismissable={!form.isDirty}
      isKeyboardDismissDisabled={form.isDirty}
      // Blocking the X without saying why is worse than discarding: the button
      // just stops working. Name the guard and the way out.
      onCloseAttempt={() =>
        toast("Discard your changes?", {
          description: "This panel has unsaved edits.",
          action: { label: "Discard", onClick: onDismiss },
        })
      }
      panelClassName="max-w-[760px]"
      footer={<JobFormFooter form={form} onCancel={onDismiss} />}
    >
      <JobFormFields form={form} />
    </SidePanelDialog>
  );
};
