import { clsx } from "clsx";
import cronstrue from "cronstrue";
import { Check, ChevronDown, ChevronRight, CopyPlus } from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Checkbox as AriaCheckbox,
  Button as AriaButton,
  ComboBox,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
} from "react-aria-components";
import { toast } from "sonner";

import { formatJobId } from "../utils/flow";
import { formatCountLabel } from "../utils/format";
import { parseDataOrNull, parseUnknownJson } from "../utils/json";
import type { JSONEditorValidationState } from "../utils/jsonEditor";
import { normalizeJSONEditorValue } from "../utils/jsonEditor";
import { getChangedLines } from "../utils/lineDiff";
import { mutationToasts } from "../utils/mutationToasts";
import { useRecentJobNames } from "../utils/recentJobNames";
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
import type { Job, Queue, Scheduler, Status } from "../utils/trpc";
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
import { StatusBadge } from "./StatusBadge";

/** The job Duplicate copies, as the panel it was opened from shows it. */
export type DuplicateSource = { job: Job; status?: Status | null };

type JobModalProps = {
  queue: Queue;
  onDismiss: () => void;
  onSuccess?: () => void;
  scheduler?: Scheduler;
  variant?: "job" | "scheduler";
  /** Opens the job form as Duplicate, filled in from this job. */
  source?: DuplicateSource;
};

const JSON_HELPER_TEXT =
  "Accepts JSON and safe JS object-literal syntax. Unquoted keys, single quotes, and trailing commas normalize on blur.";

const SCHEDULE_HINT =
  "Provide exactly one: a cron pattern or an interval in milliseconds.";

/**
 * Starting values, so the three options people actually reach for are already
 * in the editor instead of an empty `{}`. They are not the backends' defaults -
 * a job added with `{}` has no backoff at all - but with `attempts: 1` the
 * backoff never fires until attempts is raised, so an untouched form still
 * behaves exactly like an empty object.
 */
const STARTING_JOB_OPTIONS: Record<string, unknown> = {
  attempts: 1,
  backoff: { type: "exponential", delay: 1000 },
  delay: 0,
};

/**
 * The starting options narrowed to `keys`, as the editor shows them. The server
 * rejects a whole request over one key it does not accept, so an untouched form
 * may only ever carry keys the endpoint takes.
 */
const getStartingOptions = (keys: readonly string[]) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(STARTING_JOB_OPTIONS).filter(([key]) =>
        keys.includes(key),
      ),
    ),
    null,
    2,
  );

/**
 * A scheduler's template has no `delay` - the schedule decides when each job
 * runs - and the server's template schema is strict, so leaving it in rejected
 * every untouched Add scheduler form over a field the collapsed Advanced
 * section kept out of sight.
 */
const STARTING_SCHEDULER_TEMPLATE_OPTIONS = getStartingOptions([
  "attempts",
  "backoff",
]);

const EMPTY_OPTIONS = "{}";

/**
 * What a copy never takes from the job it copies: its id, the delay it already
 * waited, a schedule, and its place in a flow. A duplicate is a new job that
 * runs now - the same rule as Rerun, which Duplicate replaces.
 */
const NOT_COPIED_OPTIONS = new Set([
  "delay",
  "jobId",
  "parent",
  "repeat",
  "runAt",
  "timestamp",
]);

const toJSONText = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

/** The options of `job` a manually added job may set, as the editor shows them. */
const getCopiedOptions = (job: Job, keys: readonly string[]) => {
  const opts = parseUnknownJson(job.opts);
  const record =
    opts && typeof opts === "object" ? (opts as Record<string, unknown>) : {};
  return toJSONText(
    Object.fromEntries(
      keys
        .filter((key) => !NOT_COPIED_OPTIONS.has(key) && record[key] != null)
        .map((key) => [key, record[key]]),
    ),
  );
};

/** Bull's unnamed jobs carry `__default__`: a copy stays unnamed. */
const toEditableName = (name: string | undefined) =>
  name && name !== "__default__" ? name : "";

const isMacPlatform = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

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
 * "Default" is measured against the form's starting values, never against the
 * values the panel opened with: on the edit path those *are* the scheduler's
 * existing configuration, and calling that "default" would collapse it out of
 * sight.
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
      normalizedTemplateOptions === STARTING_SCHEDULER_TEMPLATE_OPTIONS) &&
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

const getInitialFormValues = (
  scheduler: Scheduler | undefined,
  addJobOptionKeys: readonly string[],
  sourceJob: Job | undefined,
) => ({
  nameValue: toEditableName(sourceJob?.rawName),
  dataValue: sourceJob
    ? toJSONText(parseDataOrNull(sourceJob.data) ?? {})
    : "{}",
  // Only what this queue's adapter accepts: GroupMQ takes neither `attempts`
  // nor `backoff`, and every untouched Add job there failed on them.
  optsValue: sourceJob
    ? getCopiedOptions(sourceJob, addJobOptionKeys)
    : getStartingOptions(addJobOptionKeys),
  schedulerName: scheduler?.name ?? "manual-scheduler",
  templateDataValue: JSON.stringify(
    scheduler?.template?.data ??
      (scheduler ? {} : { message: "Scheduled from Queuedash" }),
    null,
    2,
  ),
  templateOptsValue: scheduler
    ? JSON.stringify(scheduler.template?.opts ?? {}, null, 2)
    : STARTING_SCHEDULER_TEMPLATE_OPTIONS,
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
  source,
}: JobModalProps) => {
  const schedulerScheduleDescriptionId = useId();
  const schedulerEveryId = useId();
  const schedulerNameId = useId();
  const schedulerPatternId = useId();

  const formRef = useRef<HTMLFormElement | null>(null);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

  const isJob = variant === "job";
  const isDuplicate = isJob && !!source;
  // An adapter that names no option keys accepts none, so there is nothing to
  // edit and nothing to send.
  const supportsJobOptions =
    queue.supports.addJobOptions && queue.supports.addJobOptionKeys.length > 0;
  const supportsJobNames = isJob && queue.supports.jobNames;
  const isEditingScheduler = !isJob && !!scheduler;
  const recentNames = useRecentJobNames(queue.name, supportsJobNames);

  // Dirtiness is measured against what the panel opened with - a literal "{}"
  // comparison would report every freshly-opened scheduler panel as dirty.
  const [initialValues] = useState(() =>
    getInitialFormValues(
      scheduler,
      queue.supports.addJobOptionKeys,
      source?.job,
    ),
  );
  // With Add another on, what was just added is no longer unsaved work.
  const [savedJobValues, setSavedJobValues] = useState(() => ({
    name: initialValues.nameValue,
    data: initialValues.dataValue,
    opts: initialValues.optsValue,
  }));
  const [addAnother, setAddAnother] = useState(false);

  const [nameValue, setNameValue] = useState(initialValues.nameValue);
  const [dataValue, setDataValue] = useState(initialValues.dataValue);
  const [optsValue, setOptsValue] = useState(initialValues.optsValue);

  const onJobAdded = () => {
    onSuccess?.();
    if (addAnother) {
      setSavedJobValues({ name: nameValue, data: dataValue, opts: optsValue });
    } else {
      onDismiss();
    }
  };

  const { mutate: addJob, status: addJobStatus } =
    trpc.queue.addJob.useMutation(
      mutationToasts("Job added", {
        errorMessage: "Could not add the job. Please try again.",
        onSuccess: onJobAdded,
      }),
    );

  // An unedited duplicate is a rerun: the server copies the job as it is
  // stored, so values this dashboard shows redacted keep their real contents.
  const canRerun = queue.access.actions["job.rerun"] === true;
  const { mutate: rerunJob, status: rerunStatus } = trpc.job.rerun.useMutation(
    mutationToasts("Job added", {
      errorMessage: "Could not add the job. Please try again.",
      onSuccess: onJobAdded,
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

  const [showErrors, setShowErrors] = useState(false);
  const [isPatternTouched, setIsPatternTouched] = useState(false);
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

  // Anything the panel opens with that is not a starting value is already
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
    ? rerunStatus === "pending"
      ? rerunStatus
      : addJobStatus
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
    ? nameValue !== savedJobValues.name ||
      dataValue !== savedJobValues.data ||
      optsValue !== savedJobValues.opts
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

    const isUnedited =
      nameValue.trim() === initialValues.nameValue.trim() &&
      normalizeOptionsValue(dataValue) ===
        normalizeOptionsValue(initialValues.dataValue) &&
      (!supportsJobOptions ||
        normalizeOptionsValue(optsValue) ===
          normalizeOptionsValue(initialValues.optsValue));
    if (source && canRerun && isUnedited) {
      rerunJob({ queueName: queue.name, jobId: source.job.id });
      return;
    }

    addJob({
      queueName: queue.name,
      name: supportsJobNames ? nameValue.trim() || undefined : undefined,
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
    addAnother,
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
    canRerun,
    // What a job added with no name is called: BullMQ's is ours, Bull's its own.
    defaultJobName: queue.type === "bullmq" ? "Manual add" : "Unnamed",
    isDuplicate,
    isJob,
    nameValue,
    onDismiss,
    optsValue,
    originalDataValue: isDuplicate ? initialValues.dataValue : undefined,
    originalOptsValue: isDuplicate ? initialValues.optsValue : undefined,
    recentNames,
    resetData: () => setDataValue(initialValues.dataValue),
    patternValue,
    registerField,
    schedulerName,
    schedulerOptionsValue,
    setAddAnother,
    setDataValue,
    setEveryValue,
    setIsPatternTouched,
    setJobDataValidation,
    setJobOptsValidation,
    setNameValue,
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
    source,
    status,
    submit,
    submitLabel: isJob
      ? "Add job"
      : isEditingScheduler
        ? "Save changes"
        : "Add scheduler",
    supportsJobNames,
    supportsJobOptions,
    templateDataValue,
    templateOptsValue,
    timezoneItems,
    timezoneValue,
    title: isEditingScheduler
      ? "Edit scheduler"
      : isDuplicate
        ? "Duplicate job"
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

export const JobFormFields = ({ form }: { form: JobFormController }) => {
  const { formRef } = form;

  // Cmd/Ctrl+Enter adds from anywhere in the panel, the pinned footer included.
  // Taken on the way down and stopped there: react-aria presses a focused
  // checkbox on Enter, so "Add another" would untick itself on the keyup of
  // the very shortcut that submits, and the panel would close anyway.
  useEffect(() => {
    const panel = formRef.current?.closest("[role='dialog']");
    if (!panel) return;
    const onKeyDown = (event: Event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key !== "Enter" || !(keyEvent.metaKey || keyEvent.ctrlKey)) {
        return;
      }
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      formRef.current?.requestSubmit();
    };
    panel.addEventListener("keydown", onKeyDown, true);
    return () => panel.removeEventListener("keydown", onKeyDown, true);
  }, [formRef]);

  return (
    <form
      ref={form.formRef}
      onSubmit={form.handleSubmit}
      noValidate
      className="space-y-5 p-6"
    >
      {form.isJob ? (
        <>
          {form.source ? (
            <DuplicateSourceNote
              source={form.source}
              canRerun={form.canRerun}
            />
          ) : null}

          {form.supportsJobNames ? <JobNameField form={form} /> : null}

          {/* Said once for the whole form: it is the same rule in every editor. */}
          <p className={FIELD_HINT}>{JSON_HELPER_TEXT}</p>

          <div ref={form.registerField("data")}>
            <JSONEditor
              label="Data"
              value={form.dataValue}
              onChange={form.setDataValue}
              required
              // A new job starts from its name; a copy from what to change.
              autoFocus={!form.supportsJobNames || form.isDuplicate}
              rootType="object"
              height="280px"
              showErrors={form.showErrors}
              onSubmit={form.submit}
              onValidationChange={form.setJobDataValidation}
              originalValue={form.originalDataValue}
              footer={
                form.originalDataValue === undefined ? undefined : (
                  <ChangedLinesNote
                    original={form.originalDataValue}
                    value={form.dataValue}
                    onReset={form.resetData}
                  />
                )
              }
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
                originalValue={form.originalOptsValue}
                footer={
                  form.isDuplicate ? (
                    <p className={FIELD_HINT}>
                      Not copied: the job id, its delay, and its place in a
                      flow.
                    </p>
                  ) : undefined
                }
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
      <button
        type="submit"
        tabIndex={-1}
        aria-hidden="true"
        className="hidden"
      />
    </form>
  );
};

const CHIP =
  "inline-flex h-6 items-center rounded-full border px-2.5 font-mono text-xs transition-colors duration-150";

/**
 * What workers dispatch on. The names this queue's jobs already use are one
 * click away, so a new job does not reach a worker under a typo.
 */
const JobNameField = ({ form }: { form: JobFormController }) => {
  const id = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focusOnOpen] = useState(!form.isDuplicate);

  useEffect(() => {
    if (focusOnOpen) inputRef.current?.focus();
  }, [focusOnOpen]);

  return (
    <div>
      <label htmlFor={id} className={FIELD_LABEL}>
        Name
      </label>
      <input
        id={id}
        ref={inputRef}
        value={form.nameValue}
        onChange={(event) => form.setNameValue(event.target.value)}
        placeholder={form.defaultJobName}
        spellCheck={false}
        autoComplete="off"
        className={clsx(INPUT_CLASS, FOCUS_FIELD, "font-mono text-[13px]")}
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {form.recentNames.length > 0 ? (
          <>
            <span className={clsx("mr-0.5", FIELD_HINT)}>Recent</span>
            {form.recentNames.map((name) => {
              const isChosen = form.nameValue.trim() === name;
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={isChosen}
                  onClick={() => form.setNameValue(name)}
                  className={clsx(
                    CHIP,
                    isChosen
                      ? "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-800/80 dark:bg-brand-950/50 dark:text-brand-300"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50 active:bg-gray-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800",
                    FOCUS_RING,
                  )}
                >
                  {name}
                </button>
              );
            })}
          </>
        ) : (
          <span className={FIELD_HINT}>
            Workers often pick a handler by the job&apos;s name.
          </span>
        )}
      </div>
    </div>
  );
};

/** Which job this copies, and what copying it means. */
const DuplicateSourceNote = ({
  source,
  canRerun,
}: {
  source: DuplicateSource;
  canRerun: boolean;
}) => {
  const settingsReq = trpc.settings.get.useQuery(undefined, {
    staleTime: 60_000,
  });
  const redacts = settingsReq.data?.privacy.redactionEnabled === true;

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
      <CopyPlus
        aria-hidden="true"
        className={clsx("mt-1 size-3.5 shrink-0", TEXT_MUTED)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
          <span className={TEXT_MUTED}>From</span>
          <span className="min-w-0 truncate font-mono text-gray-900 dark:text-white">
            {source.job.name}
          </span>
          <span
            title={source.job.id}
            className={clsx(
              "shrink-0 rounded-md bg-gray-100 px-1.5 font-mono text-[11px] leading-[18px] dark:bg-slate-800",
              TEXT_MUTED,
            )}
          >
            #{formatJobId(source.job.id)}
          </span>
          {source.status ? <StatusBadge status={source.status} /> : null}
        </div>
        <p className={clsx("mt-1", FIELD_HINT)}>
          Its name, data and options are copied. The original job stays as it
          is.
          {redacts
            ? canRerun
              ? " This server hides sensitive values: added unedited, the copy keeps the real ones; edited, it keeps the placeholders shown here."
              : " This server hides sensitive values, so the copy keeps the placeholders shown here."
            : null}
        </p>
      </div>
    </div>
  );
};

/** How far a copy has moved from the job it copies, and the way back. */
const ChangedLinesNote = ({
  original,
  value,
  onReset,
}: {
  original: string;
  value: string;
  onReset: () => void;
}) => {
  const changed = useMemo(
    () => getChangedLines(original, value).length,
    [original, value],
  );
  if (value === original) {
    return <p className={FIELD_HINT}>Same as the original</p>;
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <p className={FIELD_HINT}>
        {changed === 0
          ? "Lines removed from the original"
          : `${formatCountLabel(changed, "line")} changed from the original`}
      </p>
      <button
        type="button"
        onClick={onReset}
        className={clsx(
          "shrink-0 rounded text-xs font-medium transition-colors duration-150 hover:text-gray-900 active:text-gray-600 dark:hover:text-white dark:active:text-slate-300",
          TEXT_MUTED,
          FOCUS_RING,
        )}
      >
        Reset to original
      </button>
    </div>
  );
};

export const JobFormFooter = ({
  form,
  onCancel,
}: {
  form: JobFormController;
  onCancel: () => void;
}) => (
  <div className="flex items-center justify-between gap-3 border-t border-gray-100/80 bg-gray-50/50 px-6 py-4 dark:border-slate-800/60 dark:bg-slate-900/30">
    {form.isJob ? (
      // Keeps the panel open, values and all, for adding the next test job.
      <AriaCheckbox
        isSelected={form.addAnother}
        onChange={form.setAddAnother}
        className="group flex cursor-pointer items-center gap-2 text-sm text-gray-700 outline-none dark:text-slate-300"
      >
        {({ isSelected }) => (
          <>
            <span
              aria-hidden="true"
              className={clsx(
                "flex size-4 items-center justify-center rounded border transition-colors duration-150 group-data-[focus-visible]:ring-2 group-data-[focus-visible]:ring-brand-400 group-data-[focus-visible]:ring-offset-2 group-data-[focus-visible]:ring-offset-white dark:group-data-[focus-visible]:ring-brand-600 dark:group-data-[focus-visible]:ring-offset-slate-900",
                isSelected
                  ? "border-gray-900 bg-gray-900 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900"
                  : "border-gray-300 bg-white group-hover:border-gray-400 dark:border-slate-600 dark:bg-slate-900 dark:group-hover:border-slate-500",
              )}
            >
              {isSelected ? <Check className="size-3" /> : null}
            </span>
            Add another
          </>
        )}
      </AriaCheckbox>
    ) : (
      <span />
    )}
    <div className="flex items-center gap-2">
      <Button label="Cancel" size="lg" onClick={onCancel} />
      <Button
        label={form.submitLabel}
        shortcut={isMacPlatform() ? "⌘↵" : "Ctrl ↵"}
        size="lg"
        variant="filled"
        colorScheme="brand"
        isLoading={form.status === "pending"}
        disabled={form.isFormInvalid}
        onClick={form.submit}
      />
    </div>
  </div>
);

export const AddJobModal = ({
  queue,
  onDismiss,
  onSuccess,
  scheduler,
  variant = "job",
  source,
}: JobModalProps) => {
  const form = useJobForm({
    queue,
    onDismiss,
    onSuccess,
    scheduler,
    variant,
    source,
  });

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
      // Duplicate opens over the job panel, whose j/k would step it away.
      ownsShortcuts={!!source}
      footer={<JobFormFooter form={form} onCancel={onDismiss} />}
    >
      <JobFormFields form={form} />
    </SidePanelDialog>
  );
};
