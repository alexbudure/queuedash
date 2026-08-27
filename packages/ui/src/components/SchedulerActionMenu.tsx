import { Pencil, Trash2 } from "lucide-react";
import { useEffect } from "react";

import type { Scheduler } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { Button } from "./Button";

type SchedulerActionMenuProps = {
  canRemove: boolean;
  canUpdate: boolean;
  scheduler: Scheduler;
  queueName: string;
  onRemove?: () => void;
  onUpdate?: () => void;
};
export const SchedulerActionMenu = ({
  canRemove,
  canUpdate,
  scheduler,
  queueName,
  onRemove,
  onUpdate,
}: SchedulerActionMenuProps) => {
  const removeMutation = trpc.scheduler.remove.useMutation();

  useEffect(() => {
    if (removeMutation.isSuccess) {
      onRemove?.();
    }
  }, [removeMutation.isSuccess, onRemove]);

  const input = {
    queueName,
    jobSchedulerId: scheduler.key,
  };

  if (!canRemove && !canUpdate) return null;

  return (
    <>
      {canUpdate ? (
        <Button
          size="sm"
          label="Edit"
          icon={<Pencil className="size-3.5" />}
          onClick={onUpdate}
        />
      ) : null}
      {canRemove ? (
        <Button
          size="sm"
          label="Remove"
          colorScheme="red"
          icon={<Trash2 className="size-3.5" />}
          onClick={() => removeMutation.mutate(input)}
          isLoading={removeMutation.isPending}
        />
      ) : null}
    </>
  );
};
