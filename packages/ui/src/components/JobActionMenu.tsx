import { ActionMenu } from "./ActionMenu";
import type { Job, Queue } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { Check, Copy, Rocket, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Button } from "./Button";

type JobActionMenuProps = {
  job: Job;
  queueName: string;
  queue?: Queue;
  onRemove?: () => void;
};
export const JobActionMenu = ({
  job,
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

  const input = {
    queueName,
    jobId: job.id,
  };

  const supportsRetry = queue?.supports.retry !== false;
  const supportsPromote = queue?.supports.promote !== false;
  const showRetry = !!job.failedReason && supportsRetry;
  const showPromote = !job.finishedAt && supportsPromote;
  const showDiscard = !job.finishedAt;
  const showClone = true;

  const dropdownActions = useMemo(() => {
    const actions = [];
    if (showRetry) {
      actions.push({
        label: "Retry",
        onSelect: () => retryMutation.mutate(input),
        icon: <RotateCw className="size-4" />,
      });
    }
    if (showPromote) {
      actions.push({
        label: "Promote",
        onSelect: () => promoteMutation.mutate(input),
        icon: <Rocket className="size-4" />,
      });
    }
    if (showDiscard) {
      actions.push({
        label: "Discard",
        onSelect: () => discardMutation.mutate(input),
        icon: <Check className="size-4" />,
      });
    }
    if (showClone) {
      actions.push({
        label: "Clone",
        onSelect: () => rerunMutation.mutate(input),
        icon: <Copy className="size-4" />,
      });
    }
    actions.push({
      label: "Remove",
      onSelect: () => removeMutation.mutate(input),
      icon: <Trash2 className="size-4" />,
      tone: "destructive" as const,
    });
    return actions;
  }, [
    showRetry,
    showPromote,
    showDiscard,
    showClone,
    input,
    retryMutation,
    promoteMutation,
    discardMutation,
    rerunMutation,
    removeMutation,
  ]);

  return (
    <>
      {/* Desktop: all actions inline */}
      <div className="hidden items-center gap-2 sm:flex">
        {showRetry ? (
          <Button
            size="sm"
            label="Retry"
            icon={<RotateCw className="size-3.5" />}
            onClick={() => retryMutation.mutate(input)}
            isLoading={retryMutation.isPending}
          />
        ) : null}

        {showPromote ? (
          <Button
            size="sm"
            label="Promote"
            icon={<Rocket className="size-3.5" />}
            onClick={() => promoteMutation.mutate(input)}
            isLoading={promoteMutation.isPending}
          />
        ) : null}

        {showDiscard ? (
          <Button
            size="sm"
            label="Discard"
            icon={<Check className="size-3.5" />}
            onClick={() => discardMutation.mutate(input)}
            isLoading={discardMutation.isPending}
          />
        ) : null}

        {showClone ? (
          <Button
            size="sm"
            label="Clone"
            icon={<Copy className="size-3.5" />}
            onClick={() => rerunMutation.mutate(input)}
            isLoading={rerunMutation.isPending}
          />
        ) : null}

        <Button
          size="sm"
          label="Remove"
          colorScheme="red"
          icon={<Trash2 className="size-3.5" />}
          onClick={() => removeMutation.mutate(input)}
          isLoading={removeMutation.isPending}
        />
      </div>

      {/* Mobile: everything in dropdown */}
      <div className="sm:hidden">
        <ActionMenu actions={dropdownActions} />
      </div>
    </>
  );
};
