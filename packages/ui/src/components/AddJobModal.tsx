import type { Queue } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { Button } from "./Button";
import { useState } from "react";
import { toast } from "sonner";
import { SidePanelDialog } from "./SidePanelDialog";

type JobModalProps = {
  queue: Queue;
  onDismiss: () => void;
  variant?: "job" | "scheduler";
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
      onError(e) {
        toast.error(e.message);
      },
    });

  const { mutate: addJobScheduler, status: addSchedulerStatus } =
    trpc.queue.addJobScheduler.useMutation({
      onSuccess() {
        toast.success("New job scheduler has been added");
        onDismiss();
      },
      onError(e) {
        toast.error(e.message);
      },
    });

  const [value, setValue] = useState("{}");
  const [optsValue, setOptsValue] = useState("{}");
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

  const isJob = variant === "job";
  const status = isJob ? addJobStatus : addSchedulerStatus;

  const onAddJob = () => {
    try {
      const data = JSON.parse(value || "{}");
      const opts = optsValue.trim() ? JSON.parse(optsValue) : {};

      addJob({
        queueName: queue.name,
        data,
        opts,
      });
    } catch {
      toast.error("Invalid JSON");
    }
  };

  const onAddScheduler = () => {
    try {
      const parsedData = JSON.parse(templateDataValue || "{}");
      const parsedTemplateOpts = templateOptsValue.trim()
        ? JSON.parse(templateOptsValue)
        : {};
      const parsedSchedulerOpts = schedulerOptionsValue.trim()
        ? JSON.parse(schedulerOptionsValue)
        : {};

      const trimmedPattern = patternValue.trim();
      const parsedEvery = everyValue.trim()
        ? Number(everyValue.trim())
        : undefined;
      if (!trimmedPattern && !parsedEvery) {
        toast.error("Provide either a cron pattern or interval");
        return;
      }

      if (
        parsedEvery !== undefined &&
        (!Number.isFinite(parsedEvery) || parsedEvery <= 0)
      ) {
        toast.error("Interval must be a positive number");
        return;
      }

      addJobScheduler({
        queueName: queue.name,
        template: {
          name: schedulerName.trim() || undefined,
          data: parsedData,
          opts: parsedTemplateOpts,
        },
        opts: {
          ...parsedSchedulerOpts,
          pattern: trimmedPattern || undefined,
          every: parsedEvery,
          tz: timezoneValue.trim() || undefined,
        },
      });
    } catch {
      toast.error("Invalid JSON");
    }
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
      panelClassName="max-w-[720px]"
    >
      <div className="flex h-full flex-col">
        <div className="space-y-5 p-6">
          {isJob ? (
            <>
              <div>
                <label className="mb-1.5 block text-xs text-gray-500 dark:text-slate-400">
                  Data (JSON)
                </label>
                <textarea
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  rows={10}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-900 outline-none transition-colors focus:border-gray-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-slate-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs text-gray-500 dark:text-slate-400">
                  Options (JSON)
                </label>
                <textarea
                  value={optsValue}
                  onChange={(e) => setOptsValue(e.target.value)}
                  rows={8}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-900 outline-none transition-colors focus:border-gray-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-slate-500"
                />
              </div>
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
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-gray-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-slate-500"
                  placeholder="manual-scheduler"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs text-gray-500 dark:text-slate-400">
                    Cron pattern
                  </label>
                  <input
                    value={patternValue}
                    onChange={(e) => setPatternValue(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-900 outline-none transition-colors focus:border-gray-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-slate-500"
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
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-900 outline-none transition-colors focus:border-gray-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-slate-500"
                    placeholder="60000"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs text-gray-500 dark:text-slate-400">
                  Timezone
                </label>
                <input
                  value={timezoneValue}
                  onChange={(e) => setTimezoneValue(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-900 outline-none transition-colors focus:border-gray-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-slate-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs text-gray-500 dark:text-slate-400">
                  Template data (JSON)
                </label>
                <textarea
                  value={templateDataValue}
                  onChange={(e) => setTemplateDataValue(e.target.value)}
                  rows={8}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-900 outline-none transition-colors focus:border-gray-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-slate-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs text-gray-500 dark:text-slate-400">
                  Template opts (JSON)
                </label>
                <textarea
                  value={templateOptsValue}
                  onChange={(e) => setTemplateOptsValue(e.target.value)}
                  rows={6}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-900 outline-none transition-colors focus:border-gray-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-slate-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs text-gray-500 dark:text-slate-400">
                  Scheduler opts (JSON)
                </label>
                <textarea
                  value={schedulerOptionsValue}
                  onChange={(e) => setSchedulerOptionsValue(e.target.value)}
                  rows={6}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-900 outline-none transition-colors focus:border-gray-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-slate-500"
                />
              </div>
            </>
          )}
        </div>

        <div className="mt-auto flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4 dark:border-slate-800">
          <Button label="Cancel" onClick={onDismiss} />
          <Button
            label={isJob ? "Add job" : "Add scheduler"}
            variant="filled"
            disabled={status === "pending"}
            onClick={isJob ? onAddJob : onAddScheduler}
          />
        </div>
      </div>
    </SidePanelDialog>
  );
};
