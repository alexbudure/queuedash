import { Pencil, Trash2 } from "lucide-react";

import { mutationToasts } from "../utils/mutationToasts";
import type { Scheduler } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { Alert } from "./Alert";
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
  const removeMutation = trpc.scheduler.remove.useMutation(
    mutationToasts("Scheduler removed", { onSuccess: () => onRemove?.() }),
  );

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
        <Alert
          isPending={removeMutation.isPending}
          title="Remove this scheduler?"
          description={`This action cannot be undone. "${scheduler.name}" will stop scheduling new runs; jobs it has already enqueued are left alone.`}
          action={
            <Button
              variant="filled"
              colorScheme="red"
              label="Yes, remove"
              onClick={() => removeMutation.mutate(input)}
            />
          }
        >
          <Button
            as="span"
            size="sm"
            label="Remove"
            colorScheme="red"
            icon={<Trash2 className="size-3.5" />}
            isLoading={removeMutation.isPending}
          />
        </Alert>
      ) : null}
    </>
  );
};
