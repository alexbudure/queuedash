import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import type { JSONEditorValidationState } from "../utils/jsonEditor";
import { normalizeJSONEditorValue } from "../utils/jsonEditor";
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

const errorTextClassName = "mt-1.5 text-xs text-red-600 dark:text-red-400";

const inputClassName =
  "w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-white dark:focus:border-brand-600 dark:focus:ring-brand-950";

const TIMEZONES = Intl.supportedValuesOf("timeZone");

const SectionHeader = ({ children }: { children: React.ReactNode }) => (
  <div className="border-t border-gray-100 pt-5 dark:border-slate-800/60">
    <h3 className="mb-4 text-xs font-medium tracking-wide text-gray-400 uppercase dark:text-slate-500">
      {children}
    </h3>
  </div>
);

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

export const SchedulerScheduleInputs = ({
  descriptionId,
  everyId,
  everyValue,
  onEveryValueChange,
  onPatternValueChange,
  patternId,
  patternValue,
  scheduleError,
}: {
  descriptionId: string;
  everyId: string;
  everyValue: string;
  onEveryValueChange: (value: string) => void;
  onPatternValueChange: (value: string) => void;
  patternId: string;
  patternValue: string;
  scheduleError: string | null;
}) => (
  <>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label
          htmlFor={patternId}
          className="mb-1.5 block text-xs text-gray-500 dark:text-slate-400"
        >
          Cron pattern
        </label>
        <input
          id={patternId}
          value={patternValue}
          onChange={(event) => onPatternValueChange(event.target.value)}
          aria-describedby={descriptionId}
          aria-invalid={scheduleError ? true : undefined}
          className={`${inputClassName} font-mono text-xs`}
          placeholder="0 * * * *"
        />
      </div>

      <div>
        <label
          htmlFor={everyId}
          className="mb-1.5 block text-xs text-gray-500 dark:text-slate-400"
        >
          Interval (ms)
        </label>
        <input
          id={everyId}
          value={everyValue}
          onChange={(event) => onEveryValueChange(event.target.value)}
          aria-describedby={descriptionId}
          aria-invalid={scheduleError ? true : undefined}
          className={`${inputClassName} font-mono text-xs`}
          placeholder="60000"
        />
      </div>
    </div>

    <p
      id={descriptionId}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={
        scheduleError
          ? errorTextClassName
          : "text-xs text-gray-500 dark:text-slate-400"
      }
    >
      {scheduleError ??
        "Provide exactly one: a cron pattern or an interval in milliseconds."}
    </p>
  </>
);

export const AddJobModal = ({
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
  const schedulerTimezoneId = useId();
  const { mutate: addJob, status: addJobStatus } =
    trpc.queue.addJob.useMutation({
      onSuccess() {
        toast.success("New job has been added");
        onSuccess?.();
        onDismiss();
      },
      onError(error) {
        toast.error(error.message);
      },
    });

  const { mutate: addJobScheduler, status: addSchedulerStatus } =
    trpc.queue.addJobScheduler.useMutation({
      onSuccess() {
        toast.success("New job scheduler has been added");
        onSuccess?.();
        onDismiss();
      },
      onError(error) {
        toast.error(error.message);
      },
    });

  const { mutate: updateJobScheduler, status: updateSchedulerStatus } =
    trpc.scheduler.update.useMutation({
      onSuccess() {
        toast.success("Job scheduler has been updated");
        onSuccess?.();
        onDismiss();
      },
      onError(error) {
        toast.error(error.message);
      },
    });

  const [dataValue, setDataValue] = useState("{}");
  const [optsValue, setOptsValue] = useState("{}");
  const [jobDataValidation, setJobDataValidation] =
    useState<JSONEditorValidationState>(() =>
      getInitialValidationState("{}", "Data", true),
    );
  const [jobOptsValidation, setJobOptsValidation] =
    useState<JSONEditorValidationState>(() =>
      getInitialValidationState("{}", "Options"),
    );

  const [schedulerName, setSchedulerName] = useState(
    scheduler?.name ?? "manual-scheduler",
  );
  const [templateDataValue, setTemplateDataValue] = useState(
    JSON.stringify(
      scheduler?.template?.data ??
        (scheduler ? {} : { message: "Scheduled from Queuedash" }),
      null,
      2,
    ),
  );
  const [templateOptsValue, setTemplateOptsValue] = useState(
    JSON.stringify(
      scheduler?.template?.opts ?? (scheduler ? {} : { attempts: 1 }),
      null,
      2,
    ),
  );
  const [patternValue, setPatternValue] = useState(
    scheduler?.pattern ?? (scheduler ? "" : "0 * * * *"),
  );
  const [everyValue, setEveryValue] = useState(
    scheduler?.every ? String(scheduler.every) : "",
  );
  const [timezoneValue, setTimezoneValue] = useState(
    getInitialSchedulerTimezone({
      browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      isEditing: !!scheduler,
      schedulerTimezone: scheduler?.tz,
    }),
  );
  const [schedulerOptionsValue, setSchedulerOptionsValue] = useState(
    JSON.stringify(
      {
        limit: scheduler?.limit,
        startDate: scheduler?.startDate,
        endDate: scheduler?.endDate,
        offset: scheduler?.offset,
      },
      null,
      2,
    ),
  );
  const [templateDataValidation, setTemplateDataValidation] =
    useState<JSONEditorValidationState>(() =>
      getInitialValidationState(templateDataValue, "Template data", true),
    );
  const [templateOptsValidation, setTemplateOptsValidation] =
    useState<JSONEditorValidationState>(() =>
      getInitialValidationState(templateOptsValue, "Template opts"),
    );
  const [schedulerOptionsValidation, setSchedulerOptionsValidation] =
    useState<JSONEditorValidationState>(() =>
      getInitialValidationState(schedulerOptionsValue, "Scheduler opts"),
    );

  const isJob = variant === "job";
  const supportsJobOptions = queue.supports.addJobOptions;
  const isEditingScheduler = !isJob && !!scheduler;
  const status = isJob
    ? addJobStatus
    : isEditingScheduler
      ? updateSchedulerStatus
      : addSchedulerStatus;

  const schedulerScheduleError = useMemo(() => {
    return getSchedulerScheduleError(patternValue, everyValue);
  }, [everyValue, patternValue]);
  const timezoneOptions = useMemo(
    () => getSchedulerTimezoneOptions(TIMEZONES, timezoneValue),
    [timezoneValue],
  );

  const isJobFormInvalid =
    !jobDataValidation.isValid ||
    (supportsJobOptions && !jobOptsValidation.isValid);
  const isSchedulerFormInvalid =
    !templateDataValidation.isValid ||
    !templateOptsValidation.isValid ||
    !schedulerOptionsValidation.isValid ||
    !!schedulerScheduleError;

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

    if (!normalizedData.isValid || normalizedOpts?.isValid === false) {
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
      label: "Template opts",
      setValue: setTemplateOptsValue,
      setValidation: setTemplateOptsValidation,
    });
    const normalizedSchedulerOpts = normalizeObjectField({
      value: schedulerOptionsValue,
      label: "Scheduler opts",
      setValue: setSchedulerOptionsValue,
      setValidation: setSchedulerOptionsValidation,
    });
    const nextSchedulerScheduleError = getSchedulerScheduleError(
      patternValue,
      everyValue,
    );

    if (
      !normalizedTemplateData.isValid ||
      !normalizedTemplateOpts.isValid ||
      !normalizedSchedulerOpts.isValid ||
      nextSchedulerScheduleError
    ) {
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

  return (
    <SidePanelDialog
      title={
        isEditingScheduler
          ? "Edit scheduler"
          : `Add ${isJob ? "job" : "scheduler"}`
      }
      subtitle={queue.displayName}
      open={true}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onDismiss();
        }
      }}
      panelClassName="max-w-[760px]"
    >
      <div className="flex h-full flex-col">
        <div className="space-y-5 p-6">
          {isJob ? (
            <>
              <JSONEditor
                label="Data"
                value={dataValue}
                onChange={setDataValue}
                required
                rootType="object"
                helperText={JSON_HELPER_TEXT}
                height="280px"
                onValidationChange={setJobDataValidation}
              />

              {supportsJobOptions ? (
                <JSONEditor
                  label="Options"
                  value={optsValue}
                  onChange={setOptsValue}
                  rootType="object"
                  helperText={JSON_HELPER_TEXT}
                  height="240px"
                  onValidationChange={setJobOptsValidation}
                />
              ) : (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                  This queue accepts job data only; its adapter does not support
                  job options.
                </p>
              )}
            </>
          ) : (
            <>
              <div>
                <label
                  htmlFor={schedulerNameId}
                  className="mb-1.5 block text-xs text-gray-500 dark:text-slate-400"
                >
                  Scheduler name
                </label>
                <input
                  id={schedulerNameId}
                  value={schedulerName}
                  onChange={(e) => setSchedulerName(e.target.value)}
                  className={inputClassName}
                  placeholder="manual-scheduler"
                />
              </div>

              <SectionHeader>Schedule</SectionHeader>

              <SchedulerScheduleInputs
                descriptionId={schedulerScheduleDescriptionId}
                everyId={schedulerEveryId}
                everyValue={everyValue}
                onEveryValueChange={setEveryValue}
                onPatternValueChange={setPatternValue}
                patternId={schedulerPatternId}
                patternValue={patternValue}
                scheduleError={schedulerScheduleError}
              />

              <div>
                <label
                  htmlFor={schedulerTimezoneId}
                  className="mb-1.5 block text-xs text-gray-500 dark:text-slate-400"
                >
                  Timezone
                </label>
                <select
                  id={schedulerTimezoneId}
                  value={timezoneValue}
                  onChange={(e) => setTimezoneValue(e.target.value)}
                  className={`${inputClassName} font-mono text-xs`}
                >
                  <option value="">No timezone override</option>
                  {timezoneOptions.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>

              <SectionHeader>Template</SectionHeader>

              <JSONEditor
                label="Template data"
                value={templateDataValue}
                onChange={setTemplateDataValue}
                required
                rootType="object"
                helperText={JSON_HELPER_TEXT}
                height="240px"
                onValidationChange={setTemplateDataValidation}
              />

              <JSONEditor
                label="Template opts"
                value={templateOptsValue}
                onChange={setTemplateOptsValue}
                rootType="object"
                helperText={JSON_HELPER_TEXT}
                height="220px"
                onValidationChange={setTemplateOptsValidation}
              />

              <SectionHeader>Advanced</SectionHeader>

              <JSONEditor
                label="Scheduler opts"
                value={schedulerOptionsValue}
                onChange={setSchedulerOptionsValue}
                rootType="object"
                helperText={JSON_HELPER_TEXT}
                height="220px"
                onValidationChange={setSchedulerOptionsValidation}
              />
            </>
          )}
        </div>

        <div className="mt-auto flex items-center justify-end gap-2 border-t border-gray-100/80 bg-gray-50/50 px-6 py-4 dark:border-slate-800/60 dark:bg-slate-900/30">
          <Button label="Cancel" onClick={onDismiss} />
          <Button
            label={
              isJob
                ? "Add job"
                : isEditingScheduler
                  ? "Save changes"
                  : "Add scheduler"
            }
            variant="filled"
            disabled={
              status === "pending" ||
              (isJob ? isJobFormInvalid : isSchedulerFormInvalid)
            }
            onClick={isJob ? onAddJob : onAddScheduler}
          />
        </div>
      </div>
    </SidePanelDialog>
  );
};
