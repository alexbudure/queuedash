import { clsx } from "clsx";
import cronstrue from "cronstrue";
import { AlertTriangle, Calendar, Clock } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { parseDataOrNull } from "../utils/json";
import { SECTION_LABEL, TEXT_MUTED } from "../utils/styles";
import type { Queue, Scheduler } from "../utils/trpc";
import { JobFormFields, JobFormFooter, useJobForm } from "./AddJobModal";
import { CopyButton } from "./CopyButton";
import {
  DetailBody,
  DetailSection,
  DisclosureButton,
  Property,
  PropertyList,
} from "./DetailView";
import { JsonPane } from "./JsonPane";
import { SchedulerActionMenu } from "./SchedulerActionMenu";
import { SidePanelDialog } from "./SidePanelDialog";
import { Timestamp } from "./Timestamp";

type SchedulerModalProps = {
  canRemove: boolean;
  canUpdate: boolean;
  scheduler: Scheduler;
  queue: Queue;
  onDismiss: () => void;
};

const formatEvery = (every?: number) => {
  if (!every) return "-";
  const seconds = every / 1000;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
};

const getScheduleLabel = (scheduler: Scheduler) => {
  if (scheduler.pattern) {
    try {
      return cronstrue.toString(scheduler.pattern, { verbose: true });
    } catch {
      return scheduler.pattern;
    }
  }

  if (scheduler.every) {
    return `Every ${formatEvery(scheduler.every)}`;
  }

  return "No schedule configured";
};

const BROWSER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export const SchedulerModal = ({
  canRemove,
  canUpdate,
  scheduler,
  queue,
  onDismiss,
}: SchedulerModalProps) => {
  const [showRawDetails, setShowRawDetails] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const rawId = useId();

  const closeEdit = () => setShowEdit(false);

  // Details and edit share one mounted dialog: swapping in a second
  // SidePanelDialog re-fired the slide-in with no exit and jumped the panel
  // width mid-transition. The form state outlives a cancel, so returning to
  // the details view and reopening the editor keeps unsaved edits.
  const form = useJobForm({
    queue,
    scheduler,
    variant: "scheduler",
    onDismiss: closeEdit,
    onSuccess: onDismiss,
  });

  const scheduleLabel = useMemo(() => getScheduleLabel(scheduler), [scheduler]);

  const templateData = useMemo(
    () => parseDataOrNull(scheduler.template?.data),
    [scheduler.template],
  );

  const templateOpts = useMemo(() => {
    const rawTemplate = scheduler.template as
      | Record<string, unknown>
      | undefined;
    return parseDataOrNull(rawTemplate?.opts);
  }, [scheduler.template]);

  const schedulerDetails = useMemo(() => {
    const details = { ...scheduler } as Record<string, unknown>;
    delete details.template;
    return details;
  }, [scheduler]);

  const nextRunDate = scheduler.next ? new Date(scheduler.next) : null;
  const identifier = scheduler.id ?? scheduler.key;

  return (
    <SidePanelDialog
      title={showEdit ? "Edit scheduler" : scheduler.name}
      titleClassName={showEdit ? undefined : "font-mono text-[15px]"}
      subtitle={
        showEdit ? (
          queue.displayName
        ) : (
          <>
            <span
              className={clsx("truncate font-mono", TEXT_MUTED)}
              title={identifier}
            >
              {identifier}
            </span>
            <CopyButton value={identifier} label="Scheduler key" />
          </>
        )
      }
      open={true}
      onOpenChange={(isOpen) => {
        // Editing is a sub-view of the details panel, not a separate dialog:
        // closing an edit returns to details, as it did before the two were
        // merged into one mounted dialog. Only details closes the panel.
        if (!isOpen) {
          if (showEdit) closeEdit();
          else onDismiss();
        }
      }}
      isDismissable={!showEdit || !form.isDirty}
      isKeyboardDismissDisabled={showEdit && form.isDirty}
      panelClassName="max-w-[760px]"
      headerActions={
        showEdit ? null : (
          <SchedulerActionMenu
            canRemove={canRemove}
            canUpdate={canUpdate}
            queueName={queue.name}
            scheduler={scheduler}
            onRemove={onDismiss}
            onUpdate={() => setShowEdit(true)}
          />
        )
      }
      footer={
        showEdit ? <JobFormFooter form={form} onCancel={closeEdit} /> : null
      }
    >
      {showEdit ? (
        <JobFormFields form={form} />
      ) : (
        <DetailBody>
          {/* The schedule is what a scheduler is, so it leads as one card:
              what it says in words, what it says in cron, and when it fires
              next - which used to be a second box underneath. */}
          <DetailSection>
            <div className="rounded-lg bg-gray-50/80 dark:bg-slate-800/40">
              <div className="p-3.5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p
                      className={clsx(
                        "inline-flex items-center gap-1.5",
                        SECTION_LABEL,
                      )}
                    >
                      <Clock aria-hidden="true" className="size-3" />
                      Schedule
                    </p>
                    <p
                      title={scheduleLabel}
                      className="mt-1.5 text-sm font-medium text-gray-900 dark:text-white"
                    >
                      {scheduleLabel}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100/80 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-slate-700/60 dark:text-slate-400">
                    {scheduler.pattern
                      ? "Cron"
                      : scheduler.every
                        ? "Interval"
                        : "Unscheduled"}
                  </span>
                </div>

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {scheduler.pattern ? (
                    <span className="inline-flex items-center rounded-full bg-blue-50/80 px-2.5 py-0.5 font-mono text-xs text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                      {scheduler.pattern}
                    </span>
                  ) : null}
                  {scheduler.every ? (
                    <span className="inline-flex items-center rounded-full bg-blue-50/80 px-2.5 py-0.5 text-xs text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                      Every {formatEvery(scheduler.every)}
                    </span>
                  ) : null}
                  {scheduler.tz ? (
                    <span className="inline-flex items-center rounded-full bg-gray-100/80 px-2.5 py-0.5 text-xs text-gray-500 dark:bg-slate-700/60 dark:text-slate-400">
                      {scheduler.tz}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="border-t border-gray-100 dark:border-slate-800">
                {nextRunDate ? (
                  <div className="flex items-start gap-2.5 px-3.5 py-2.5 text-xs">
                    <Calendar
                      aria-hidden="true"
                      className="mt-0.5 size-3.5 shrink-0 text-blue-500 dark:text-blue-400"
                    />
                    <div className="min-w-0 flex-1">
                      {/* Rendered in the scheduler's own zone so it agrees with
                          the cron above it; the viewer's local time follows
                          underneath rather than sitting on the same line in a
                          different zone. */}
                      <span className="font-medium text-gray-900 dark:text-white">
                        Next run{" "}
                        <Timestamp
                          value={nextRunDate}
                          variant="full"
                          timeZone={scheduler.tz ?? undefined}
                        />
                      </span>
                      {scheduler.tz && scheduler.tz !== BROWSER_TIME_ZONE ? (
                        <span className={clsx("mt-0.5 block", TEXT_MUTED)}>
                          <Timestamp value={nextRunDate} variant="full" /> local
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                    <AlertTriangle
                      aria-hidden="true"
                      className="size-3.5 shrink-0 text-amber-500 dark:text-amber-400"
                    />
                    <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
                      No next run scheduled
                    </span>
                  </div>
                )}
              </div>
            </div>
          </DetailSection>

          <DetailSection
            title="Properties"
            action={
              <DisclosureButton
                isOpen={showRawDetails}
                controls={rawId}
                onToggle={() => setShowRawDetails((prev) => !prev)}
              >
                {showRawDetails ? "Hide raw options" : "Raw options"}
              </DisclosureButton>
            }
          >
            <PropertyList>
              <Property label="Queue" value={queue.displayName} />
              <Property label="Key" mono value={scheduler.key} />
              {scheduler.id ? (
                <Property label="ID" mono value={scheduler.id} />
              ) : null}
              <Property
                label="Total runs"
                mono
                value={
                  scheduler.iterationCount !== undefined
                    ? String(scheduler.iterationCount)
                    : "-"
                }
              />
              <Property
                label="Limit"
                mono={scheduler.limit !== undefined}
                value={
                  scheduler.limit !== undefined
                    ? String(scheduler.limit)
                    : "No limit"
                }
              />
              <Property
                label="End date"
                value={
                  scheduler.endDate ? (
                    <Timestamp value={scheduler.endDate} variant="full" />
                  ) : (
                    "None"
                  )
                }
              />
            </PropertyList>
            <div id={rawId}>
              {showRawDetails ? (
                <JsonPane
                  data={schedulerDetails}
                  expand="all"
                  className="mt-3"
                />
              ) : null}
            </div>
          </DetailSection>

          {templateData !== null ? (
            <DetailSection title="Template data">
              <JsonPane data={templateData} expand="all" />
            </DetailSection>
          ) : null}

          {templateOpts !== null ? (
            <DetailSection title="Template options">
              <JsonPane data={templateOpts} expand="all" />
            </DetailSection>
          ) : null}
        </DetailBody>
      )}
    </SidePanelDialog>
  );
};
