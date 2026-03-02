import { Button } from "./Button";
import type { Scheduler } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { Trash2 } from "lucide-react";
import { useEffect } from "react";

type SchedulerActionMenuProps = {
  scheduler: Scheduler;
  queueName: string;
  onRemove?: () => void;
};
export const SchedulerActionMenu = ({
  scheduler,
  queueName,
  onRemove,
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

  return (
    <Button
      size="sm"
      label="Remove"
      colorScheme="red"
      icon={<Trash2 className="size-3.5" />}
      onClick={() => removeMutation.mutate(input)}
      isLoading={removeMutation.isPending}
    />
  );
};
