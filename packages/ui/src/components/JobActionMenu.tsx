import { ActionMenu } from "./ActionMenu";
import type { Job } from "../utils/trpc";
import { trpc } from "../utils/trpc";

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
  const { mutate: retry } = trpc.job.retry.useMutation();
  const { mutate: discard } = trpc.job.discard.useMutation();
  const { mutate: remove } = trpc.job.remove.useMutation({
    onSuccess: () => {
      onRemove?.();
    },
  });

  const input = {
    queueName,
    jobId: job.id,
  };

  return (
    <ActionMenu
      actions={[
        {
          label: "Retry",
          onSelect: () => {
            retry(input);
          },
        },
        {
          label: "Discard",
          onSelect: () => {
            discard(input);
          },
        },
        {
          label: "Remove",
          onSelect: () => {
            remove(input);
          },
        },
      ]}
    />
  );
};
