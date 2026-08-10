import { Check, Copy, Rocket, RotateCw, Trash2 } from "lucide-react";
import { type ReactElement, useEffect, useMemo } from "react";

import type { Job, Queue, Status } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { ActionMenu } from "./ActionMenu";
import { Button } from "./Button";

type JobActionMenuProps = {
  job: Job;
  status?: Status | null;
  queueName: string;
  queue?: Queue;
  onRemove?: () => void;
};

type JobAction = {
  key: "retry" | "promote" | "discard" | "clone" | "remove";
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
  const retryMutation = trpc.job.retry.useMutation();
  const promoteMutation = trpc.job.promote.useMutation();
  const discardMutation = trpc.job.discard.useMutation();
  const rerunMutation = trpc.job.rerun.useMutation();
  const removeMutation = trpc.job.remove.useMutation();

  useEffect(() => {
    if (
      retryMutation.isSuccess ||
      promoteMutation.isSuccess ||
      discardMutation.isSuccess ||
      rerunMutation.isSuccess ||
      removeMutation.isSuccess
    ) {
      onRemove?.();
    }
  }, [
    retryMutation.isSuccess,
    promoteMutation.isSuccess,
    discardMutation.isSuccess,
    rerunMutation.isSuccess,
    removeMutation.isSuccess,
    onRemove,
  ]);

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
    !job.finishedAt && queue?.access.actions["job.discard"] === true;
  const showClone = queue?.access.actions["job.rerun"] === true;
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
    if (showClone) {
      nextActions.push({
        key: "clone",
        label: "Clone",
        onSelect: () => rerunMutation.mutate(input),
        icon: <Copy className="size-4" />,
        isLoading: rerunMutation.isPending,
      });
    }
    if (showRemove) {
      nextActions.push({
        key: "remove",
        label: "Remove",
        onSelect: () => removeMutation.mutate(input),
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
    showClone,
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
    </>
  );
};
