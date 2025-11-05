import { ActionMenu } from "./ActionMenu";
import type { Job, Queue } from "../utils/trpc";
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
  queue?: Queue;
  onRemove?: () => void;
};
export const JobActionMenu = ({
  job,
  queueName,
  queue,
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

  // Check if operations are supported by the queue adapter
  const supportsRetry = queue?.supports.retry !== false;

  // Build actions array based on job state and queue support
  const actions = [
    // Retry action - only for failed jobs and if retry is supported
    ...(job.failedReason && supportsRetry
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
    // Rerun or Discard - based on whether job is finished
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
    // Remove - always available
    {
      label: "Remove",
      onSelect: () => {
        remove(input);
      },
      icon: <TrashIcon />,
    },
  ];

  return <ActionMenu actions={actions} />;
};
