import { Check, CopyPlus, Play, RotateCw, Trash2 } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";

import { mutationToasts } from "../utils/mutationToasts";
import { isFailedJob } from "../utils/status";
import type { Job, Queue, Status } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { ActionMenu } from "./ActionMenu";
import { Alert } from "./Alert";
import { Button } from "./Button";

type JobActionMenuProps = {
  job: Job;
  status?: Status | null;
  queueName: string;
  queue?: Queue;
  /** Called with the job's id once an action has moved it out of this list. */
  onRemove?: (jobId: string) => void;
  /** Opens this job as a new one to edit and add: Duplicate. */
  onDuplicate?: () => void;
};

type JobAction = {
  key: "retry" | "promote" | "discard" | "duplicate" | "remove";
  label: string;
  onSelect: () => void;
  icon: ReactElement;
  isLoading: boolean;
  tone?: "destructive";
};

/**
 * A job's actions: the one it most likely needs (Retry, Run now) and the
 * rest. The panel places them twice over - a button and a menu in the header
 * on wider screens; a full-width button in the body and a menu in the top bar
 * on a phone - so the logic lives here and each placement renders its part.
 */
const useJobActions = ({
  job,
  status,
  queueName,
  queue,
  onRemove,
  onDuplicate,
}: JobActionMenuProps) => {
  // The id the confirmation was opened for, not a flag: the dialog must name
  // and remove that job even if the panel behind it has moved on.
  const [confirmRemoveJobId, setConfirmRemoveJobId] = useState<string | null>(
    null,
  );

  // Retry and promote move the job to a different status, so it drops out of
  // the list this panel was opened from. Closing keeps `?job=` from stranding -
  // a stale id there silently swallows the `/` and `j`/`k` shortcuts.
  // The close names the job it is for, and the page only closes a panel that
  // is still on it: a retry that landed after `j` had moved on used to close
  // the next job's panel. It is passed per `mutate` call, so a menu the panel
  // has since swapped out (it is keyed by job) drops it; the toasts stay on
  // the hooks and still report the result.
  const retryMutation = trpc.job.retry.useMutation(
    mutationToasts("Job moved back to waiting"),
  );
  const promoteMutation = trpc.job.promote.useMutation(
    mutationToasts("Job promoted"),
  );
  const discardMutation = trpc.job.discard.useMutation(
    mutationToasts("Job discarded"),
  );
  // Discard and Duplicate leave the job where it is, so they correctly stay open.
  const removeMutation = trpc.job.remove.useMutation(
    mutationToasts("Job removed"),
  );

  const input = useMemo(
    () => ({
      queueName,
      jobId: job.id,
    }),
    [job.id, queueName],
  );

  const supportsRetry =
    queue?.supports.retry !== false && queue?.access.actions["job.retry"];
  const supportsPromote =
    queue?.supports.promote !== false && queue?.access.actions["job.promote"];
  const showRetry = isFailedJob(job, status) && supportsRetry;
  const showPromote = status === "delayed" && supportsPromote;
  const showDiscard =
    !job.finishedAt &&
    queue?.supports.discard === true &&
    queue.access.actions["job.discard"] === true;
  // Duplicate is Rerun with a chance to edit first: it adds a job, so it needs
  // what adding a job needs.
  const showDuplicate =
    onDuplicate !== undefined && queue?.access.actions["job.add"] === true;
  const showRemove = queue?.access.actions["job.remove"] === true;

  const actions = useMemo<JobAction[]>(() => {
    const nextActions: JobAction[] = [];
    if (showRetry) {
      nextActions.push({
        key: "retry",
        label: "Retry",
        onSelect: () =>
          retryMutation.mutate(input, {
            onSuccess: () => onRemove?.(input.jobId),
          }),
        icon: <RotateCw className="size-4" />,
        isLoading: retryMutation.isPending,
      });
    }
    if (showPromote) {
      nextActions.push({
        key: "promote",
        // Promote, in BullMQ's words; what it does, in the panel's.
        label: "Run now",
        onSelect: () =>
          promoteMutation.mutate(input, {
            onSuccess: () => onRemove?.(input.jobId),
          }),
        icon: <Play className="size-4" />,
        isLoading: promoteMutation.isPending,
      });
    }
    if (showDiscard) {
      nextActions.push({
        key: "discard",
        label: "Discard",
        onSelect: () => discardMutation.mutate(input),
        icon: <Check className="size-4" />,
        isLoading: discardMutation.isPending,
      });
    }
    if (showDuplicate && onDuplicate) {
      nextActions.push({
        key: "duplicate",
        label: "Duplicate…",
        onSelect: onDuplicate,
        icon: <CopyPlus className="size-4" />,
        isLoading: false,
      });
    }
    if (showRemove) {
      nextActions.push({
        key: "remove",
        label: "Remove",
        // A MenuItem closes the menu as it fires, so the confirmation lives
        // outside the menu and is armed from here.
        onSelect: () => setConfirmRemoveJobId(job.id),
        icon: <Trash2 className="size-4" />,
        isLoading: removeMutation.isPending,
        tone: "destructive" as const,
      });
    }
    return nextActions;
  }, [
    showRetry,
    showPromote,
    showDiscard,
    showDuplicate,
    showRemove,
    input,
    job.id,
    onDuplicate,
    onRemove,
    retryMutation,
    promoteMutation,
    discardMutation,
    removeMutation,
  ]);

  const primaryAction =
    actions.find((action) => action.key === "retry") ??
    actions.find((action) => action.key === "promote");
  const overflowActions = actions.filter((action) => action !== primaryAction);
  const isAnyActionLoading = actions.some((action) => action.isLoading);

  const confirmation = (
    <Alert
      isOpen={confirmRemoveJobId !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) setConfirmRemoveJobId(null);
      }}
      isPending={removeMutation.isPending}
      title="Remove job?"
      // Falls back to this menu's job - the one it is keyed to - while the
      // dialog fades out, rather than reading "job null".
      description={`This permanently removes job ${
        confirmRemoveJobId ?? job.id
      } from ${queue?.displayName ?? queueName}. It cannot be undone.`}
      action={
        <Button
          variant="filled"
          colorScheme="red"
          label="Remove"
          onClick={() => {
            const jobId = confirmRemoveJobId;
            if (jobId === null) return;
            removeMutation.mutate(
              { queueName, jobId },
              {
                onSuccess: () => onRemove?.(jobId),
                onSettled: () => setConfirmRemoveJobId(null),
              },
            );
          }}
        />
      }
    />
  );

  return { primaryAction, overflowActions, isAnyActionLoading, confirmation };
};

/** The header's actions: a button and a menu, or on a phone just the menu. */
export const JobActionMenu = (props: JobActionMenuProps) => {
  const { primaryAction, overflowActions, isAnyActionLoading, confirmation } =
    useJobActions(props);

  return (
    <>
      <div className="hidden items-center gap-2 sm:flex">
        {primaryAction ? (
          <Button
            size="sm"
            label={primaryAction.label}
            icon={primaryAction.icon}
            onClick={primaryAction.onSelect}
            isLoading={primaryAction.isLoading}
          />
        ) : null}

        {overflowActions.length > 0 ? (
          <ActionMenu
            actions={overflowActions}
            isDisabled={isAnyActionLoading}
            ariaLabel="More job actions"
          />
        ) : null}
      </div>

      {/* A phone's top bar: the rest of the actions. The main one is a
          full-width button under the job's name. */}
      {overflowActions.length > 0 ? (
        <div className="sm:hidden">
          <ActionMenu
            actions={overflowActions}
            isDisabled={isAnyActionLoading}
            ariaLabel="More job actions"
            triggerClassName="grid size-11 place-items-center rounded-[10px] p-0"
          />
        </div>
      ) : null}

      {confirmation}
    </>
  );
};

/** A phone's full-width button for the job's main action. */
export const JobPrimaryAction = (props: JobActionMenuProps) => {
  const { primaryAction } = useJobActions(props);
  if (!primaryAction) return null;
  return (
    <Button
      size="lg"
      label={primaryAction.label}
      icon={primaryAction.icon}
      onClick={primaryAction.onSelect}
      isLoading={primaryAction.isLoading}
      className="h-11 w-full text-[15px]"
    />
  );
};
