import { ActionMenu } from "./ActionMenu";
import type { Scheduler } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { TrashIcon } from "@radix-ui/react-icons";
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
  const { mutate: remove, isSuccess: removeSuccess } =
    trpc.scheduler.remove.useMutation();

  useEffect(() => {
    if (removeSuccess) {
      onRemove?.();
    }
  }, [removeSuccess, onRemove]);

  return (
    <ActionMenu
      actions={[
        {
          label: "Remove",
          onSelect: () => {
            remove({
              queueName,
              jobSchedulerId: scheduler.key,
            });
          },
          icon: <TrashIcon />,
        },
      ]}
    />
  );
};
