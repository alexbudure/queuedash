import { ActionMenu } from "./ActionMenu";
import type { Job } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import {
  CounterClockwiseClockIcon,
  HobbyKnifeIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { useEffect } from "react";

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
  const { mutate: retry, isSuccess: retrySuccess } =
    trpc.job.retry.useMutation();
  const { mutate: discard, isSuccess: discardSuccess } =
    trpc.job.discard.useMutation();
  const { mutate: rerun, isSuccess: rerunSuccess } =
    trpc.job.rerun.useMutation();
  const { mutate: remove, isSuccess: removeSuccess } =
    trpc.job.remove.useMutation();

  useEffect(() => {
    if (retrySuccess || discardSuccess || rerunSuccess || removeSuccess) {
      onRemove?.();
    }
  }, [retrySuccess, discardSuccess, rerunSuccess, removeSuccess, onRemove]);

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
