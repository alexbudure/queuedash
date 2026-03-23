import { useMemo, useState } from "react";
import { toast } from "sonner";

import type { JSONEditorValidationState } from "../utils/jsonEditor";
import { normalizeJSONEditorValue } from "../utils/jsonEditor";
import type { Queue } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { Button } from "./Button";
import { JSONEditor } from "./JSONEditor";
import { SidePanelDialog } from "./SidePanelDialog";

type JobModalProps = {
  queue: Queue;
  onDismiss: () => void;
  variant?: "job" | "scheduler";
};

const JSON_HELPER_TEXT =
  "Accepts JSON and safe JS object-literal syntax. Unquoted keys, single quotes, and trailing commas normalize on blur.";

const errorTextClassName = "mt-1.5 text-xs text-red-600 dark:text-red-400";

const inputClassName =
  "w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-gray-300 focus:ring-1 focus:ring-gray-200 dark:border-slate-700 dark:bg-slate-900/60 dark:text-white dark:focus:border-slate-600 dark:focus:ring-slate-700/50";

const TIMEZONES = Intl.supportedValuesOf("timeZone");

const SectionHeader = ({ children }: { children: React.ReactNode }) => (
  <div className="border-t border-gray-100 pt-5 dark:border-slate-800/60">
    <h3 className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-slate-500">
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

const getSchedulerScheduleError = (
  patternValue: string,
  everyValue: string,
) => {
  const trimmedPattern = patternValue.trim();
  const trimmedEvery = everyValue.trim();

  if (!trimmedPattern && !trimmedEvery) {
    return "Provide either a cron pattern or an interval.";
  }

  if (!trimmedEvery) {
    return null;
  }

  const parsedEvery = Number(trimmedEvery);

  if (!Number.isFinite(parsedEvery) || parsedEvery <= 0) {
    return "Interval must be a positive number.";
  }

  return null;
};

export const AddJobModal = ({
  queue,
  onDismiss,
  variant = "job",
}: JobModalProps) => {
  const { mutate: addJob, status: addJobStatus } =
    trpc.queue.addJob.useMutation({
      onSuccess() {
        toast.success("New job has been added");
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

  const [schedulerName, setSchedulerName] = useState("manual-scheduler");
  const [templateDataValue, setTemplateDataValue] = useState(
    JSON.stringify(
      {
        message: "Scheduled from QueueDash",
      },
      null,
      2,
    ),
  );
  const [templateOptsValue, setTemplateOptsValue] = useState(
    JSON.stringify(
      {
        attempts: 1,
      },
      null,
      2,
    ),
  );
  const [patternValue, setPatternValue] = useState("0 * * * *");
  const [everyValue, setEveryValue] = useState("");
  const [timezoneValue, setTimezoneValue] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [schedulerOptionsValue, setSchedulerOptionsValue] = useState(
    JSON.stringify(
      {
        limit: undefined,
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
  const status = isJob ? addJobStatus : addSchedulerStatus;

  const schedulerScheduleError = useMemo(() => {
    return getSchedulerScheduleError(patternValue, everyValue);
  }, [everyValue, patternValue]);

  const isJobFormInvalid =
    !jobDataValidation.isValid || !jobOptsValidation.isValid;
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
    const normalizedOpts = normalizeObjectField({
      value: optsValue,
      label: "Options",
      setValue: setOptsValue,
      setValidation: setJobOptsValidation,
    });

    if (!normalizedData.isValid || !normalizedOpts.isValid) {
      return;
    }

    addJob({
      queueName: queue.name,
      data: normalizedData.parsedValue as Record<string, unknown>,
      opts: normalizedOpts.parsedValue as Record<string, unknown> | undefined,
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

    addJobScheduler({
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
        tz: timezoneValue.trim() || undefined,
      },
    });
  };

  return (
    <SidePanelDialog
      title={`Add ${isJob ? "job" : "scheduler"}`}
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

              <JSONEditor
                label="Options"
                value={optsValue}
                onChange={setOptsValue}
                rootType="object"
                helperText={JSON_HELPER_TEXT}
                height="240px"
                onValidationChange={setJobOptsValidation}
              />
            </>
          ) : (
            <>
              <div>
                <label className="mb-1.5 block text-xs text-gray-500 dark:text-slate-400">
                  Scheduler name
                </label>
                <input
                  value={schedulerName}
                  onChange={(e) => setSchedulerName(e.target.value)}
                  className={inputClassName}
                  placeholder="manual-scheduler"
                />
              </div>

              <SectionHeader>Schedule</SectionHeader>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs text-gray-500 dark:text-slate-400">
                    Cron pattern
                  </label>
                  <input
                    value={patternValue}
                    onChange={(e) => setPatternValue(e.target.value)}
                    className={`${inputClassName} font-mono text-xs`}
                    placeholder="0 * * * *"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs text-gray-500 dark:text-slate-400">
                    Interval (ms)
                  </label>
                  <input
                    value={everyValue}
                    onChange={(e) => setEveryValue(e.target.value)}
                    className={`${inputClassName} font-mono text-xs`}
                    placeholder="60000"
                  />
                </div>
              </div>

              {schedulerScheduleError ? (
                <p className={errorTextClassName}>{schedulerScheduleError}</p>
              ) : (
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Provide a cron pattern, an interval in milliseconds, or both.
                </p>
              )}

              <div>
                <label className="mb-1.5 block text-xs text-gray-500 dark:text-slate-400">
                  Timezone
                </label>
                <select
                  value={timezoneValue}
                  onChange={(e) => setTimezoneValue(e.target.value)}
                  className={`${inputClassName} font-mono text-xs`}
                >
                  {TIMEZONES.map((tz) => (
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
            label={isJob ? "Add job" : "Add scheduler"}
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
