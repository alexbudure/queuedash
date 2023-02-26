import { ActionMenu } from "./ActionMenu";
import type { Job } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import {
  CounterClockwiseClockIcon,
  HobbyKnifeIcon,
  TrashIcon,
} from "@radix-ui/react-icons";

type JobActionMenuProps = {
  job: Job;
  queueName: string;
  onRemove?: () => void;
};
export const JobActionMenu = ({
  job,
  queueName,
  onRemove,
}: JobActionMenuProps) => {
  const opts = {
    onSuccess: () => {
      onRemove?.();
    },
  };
  const { mutate: retry } = trpc.job.retry.useMutation(opts);
  const { mutate: discard } = trpc.job.discard.useMutation(opts);
  const { mutate: rerun } = trpc.job.rerun.useMutation(opts);
  const { mutate: remove } = trpc.job.remove.useMutation(opts);

  const input = {
    queueName,
    jobId: job.id,
  };

  return (
    <ActionMenu
      actions={[
        ...(job.failedReason
          ? [
              {
                label: "Retry",
                onSelect: () => {
                  retry(input);
                },
                icon: <CounterClockwiseClockIcon />,
              },
            ]
          : []),
        ...(job.finishedAt
          ? [
              {
                label: "Rerun",
                onSelect: () => {
                  rerun(input);
                },
                icon: <CounterClockwiseClockIcon />,
              },
            ]
          : [
              {
                label: "Discard",
                onSelect: () => {
                  discard(input);
                },
                icon: <HobbyKnifeIcon />,
              },
            ]),

        {
          label: "Remove",
          onSelect: () => {
            remove(input);
          },
          icon: <TrashIcon />,
        },
      ]}
    />
  );
};
