import { Check, CopyPlus, Rocket, RotateCw, Trash2 } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";

import { mutationToasts } from "../utils/mutationToasts";
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
  onRemove?: () => void;
};

type JobAction = {
  key: "retry" | "promote" | "discard" | "rerun" | "remove";
  label: string;
  onSelect: () => void;
  icon: ReactElement;
  isLoading: boolean;
  tone?: "destructive";
};

export const JobActionMenu = ({
  job,
  status,
  queueName,
  queue,
  onRemove,
}: JobActionMenuProps) => {
  const [confirm, setConfirm] = useState<"remove" | null>(null);

  // Retry and promote move the job to a different status, so it drops out of
  // the list this panel was opened from. Closing keeps `?job=` from stranding -
  // a stale id there silently swallows the `/` and `j`/`k` shortcuts.
  const retryMutation = trpc.job.retry.useMutation(
    mutationToasts("Job moved back to waiting", {
      onSuccess: () => onRemove?.(),
    }),
  );
  const promoteMutation = trpc.job.promote.useMutation(
    mutationToasts("Job promoted", { onSuccess: () => onRemove?.() }),
  );
  const discardMutation = trpc.job.discard.useMutation(
    mutationToasts("Job discarded"),
  );
  const rerunMutation = trpc.job.rerun.useMutation(
    mutationToasts("Rerun added to the queue"),
  );
  // Discard and rerun leave the job where it is, so they correctly stay open.
  const removeMutation = trpc.job.remove.useMutation(
    mutationToasts("Job removed", { onSuccess: () => onRemove?.() }),
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
  const showRetry = !!job.failedReason && supportsRetry;
  const showPromote = status === "delayed" && supportsPromote;
  const showDiscard =
    !job.finishedAt &&
    queue?.supports.discard === true &&
    queue.access.actions["job.discard"] === true;
  const showRerun = queue?.access.actions["job.rerun"] === true;
  const showRemove = queue?.access.actions["job.remove"] === true;

  const actions = useMemo<JobAction[]>(() => {
    const nextActions: JobAction[] = [];
    if (showRetry) {
      nextActions.push({
        key: "retry",
        label: "Retry",
        onSelect: () => retryMutation.mutate(input),
        icon: <RotateCw className="size-4" />,
        isLoading: retryMutation.isPending,
      });
    }
    if (showPromote) {
      nextActions.push({
        key: "promote",
        label: "Promote",
        onSelect: () => promoteMutation.mutate(input),
        icon: <Rocket className="size-4" />,
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
    if (showRerun) {
      nextActions.push({
        key: "rerun",
        label: "Rerun",
        onSelect: () => rerunMutation.mutate(input),
        icon: <CopyPlus className="size-4" />,
        isLoading: rerunMutation.isPending,
      });
    }
    if (showRemove) {
      nextActions.push({
        key: "remove",
        label: "Remove",
        // A MenuItem closes the menu as it fires, so the confirmation lives
        // outside the menu and is armed from here.
        onSelect: () => setConfirm("remove"),
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
    showRerun,
    showRemove,
    input,
    retryMutation,
    promoteMutation,
    discardMutation,
    rerunMutation,
    removeMutation,
  ]);

  const primaryAction =
    actions.find((action) => action.key === "retry") ??
    actions.find((action) => action.key === "promote");
  const overflowActions = actions.filter((action) => action !== primaryAction);
  const isAnyActionLoading = actions.some((action) => action.isLoading);

  return (
    <>
      {/* Desktop: keep the immediate queue action visible and tuck the rest away. */}
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

      {/* Mobile: everything in dropdown */}
      {actions.length > 0 ? (
        <div className="sm:hidden">
          <ActionMenu
            actions={actions}
            isDisabled={isAnyActionLoading}
            ariaLabel="Job actions"
          />
        </div>
      ) : null}

      <Alert
        isOpen={confirm === "remove"}
        onOpenChange={(isOpen) => {
          if (!isOpen) setConfirm(null);
        }}
        isPending={removeMutation.isPending}
        title="Remove job?"
        description={`This permanently removes job ${job.id} from ${
          queue?.displayName ?? queueName
        }. It cannot be undone.`}
        action={
          <Button
            variant="filled"
            colorScheme="red"
            label="Remove"
            onClick={() =>
              removeMutation.mutate(input, {
                onSettled: () => setConfirm(null),
              })
            }
          />
        }
      />
    </>
  );
};
