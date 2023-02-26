import { ActionMenu } from "./ActionMenu";
import type { Queue } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import {
  PauseIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { useState } from "react";
import { AddJobModal } from "./AddJobModal";

type QueueActionMenuProps = {
  queue: Queue;
};
export const QueueActionMenu = ({ queue }: QueueActionMenuProps) => {
  const { mutate: pause } = trpc.queue.pause.useMutation();
  const { mutate: resume } = trpc.queue.resume.useMutation();
  const { mutate: empty } = trpc.queue.empty.useMutation();
  const [showAddJobModal, setShowAddJobModal] = useState(false);
  const input = {
    queueName: queue.name,
  };

  return (
    <>
      <ActionMenu
        actions={[
          {
            label: queue.paused ? "Resume" : "Pause",
            onSelect: () => {
              queue.paused ? resume(input) : pause(input);
            },
            icon: queue.paused ? <PlayIcon /> : <PauseIcon />,
          },
          {
            label: "Add job",
            onSelect: () => {
              setShowAddJobModal(true);
            },
            icon: <PlusIcon />,
          },
          {
            label: "Empty",
            onSelect: () => {
              empty(input);
            },
            icon: <TrashIcon />,
          },
        ]}
      />
      {showAddJobModal ? (
        <AddJobModal
          queue={queue}
          onDismiss={() => setShowAddJobModal(false)}
        />
      ) : null}
    </>
  );
};
