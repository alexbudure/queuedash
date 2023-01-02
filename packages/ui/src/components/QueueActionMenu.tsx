import { ActionMenu } from "./ActionMenu";
import type { Queue } from "../utils/trpc";
import { trpc } from "../utils/trpc";

type QueueActionMenuProps = {
  queue: Queue;
};
export const QueueActionMenu = ({ queue }: QueueActionMenuProps) => {
  const { mutate: pause } = trpc.queue.pause.useMutation();
  const { mutate: resume } = trpc.queue.resume.useMutation();
  const { mutate: empty } = trpc.queue.empty.useMutation();
  const { mutate: addJob } = trpc.queue.addJob.useMutation({});

  const input = {
    queueName: queue.name,
  };

  return (
    <ActionMenu
      actions={[
        {
          label: queue.paused ? "Resume" : "Pause",
          onSelect: () => {
            queue.paused ? resume(input) : pause(input);
          },
        },
        {
          label: "Empty",
          onSelect: () => {
            empty(input);
          },
        },
        {
          label: "Add job",
          onSelect: () => {
            addJob(input);
          },
        },
      ]}
    />
  );
};
