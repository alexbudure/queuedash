import { Pause, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { Queue } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { ActionMenu } from "./ActionMenu";
import { AddJobModal } from "./AddJobModal";

type QueueActionMenuProps = {
  queue: Queue;
};
export const QueueActionMenu = ({ queue }: QueueActionMenuProps) => {
  const { mutate: pause } = trpc.queue.pause.useMutation();
  const { mutate: resume } = trpc.queue.resume.useMutation();
  const { mutate: empty } = trpc.queue.empty.useMutation();
  const [showAddJobModal, setShowAddJobModal] = useState(false);
  const [showAddSchedulerModal, setShowAddSchedulerModal] = useState(false);
  const input = {
    queueName: queue.name,
  };
  const allowed = queue.access.actions;

  // Build actions array based on what the queue supports
  const actions = [
    // Pause/Resume - only show if supported
    ...(queue.supports.pause &&
    queue.supports.resume &&
    (queue.paused ? allowed["queue.resume"] : allowed["queue.pause"])
      ? [
          {
            label: queue.paused ? "Resume" : "Pause",
            onSelect: () => {
              if (queue.paused) {
                resume(input);
              } else {
                pause(input);
              }
            },
            icon: queue.paused ? <Play size={15} /> : <Pause size={15} />,
            tone: "warning" as const,
          },
        ]
      : []),
    // Add job - always available
    ...(allowed["job.add"]
      ? [
          {
            label: "Add job",
            onSelect: () => {
              setShowAddJobModal(true);
            },
            icon: <Plus size={15} />,
          },
        ]
      : []),
    // Add scheduler - only for queues that support it
    ...(queue.supports.schedulers && allowed["scheduler.add"]
      ? [
          {
            label: "Add scheduler",
            onSelect: () => {
              setShowAddSchedulerModal(true);
            },
            icon: <Plus size={15} />,
          },
        ]
      : []),
    // Empty - only if supported
    ...(queue.supports.empty && allowed["queue.empty"]
      ? [
          {
            label: "Empty",
            onSelect: () => {
              empty(input);
            },
            icon: <Trash2 size={15} />,
            tone: "destructive" as const,
          },
        ]
      : []),
  ];

  return (
    <>
      {actions.length > 0 ? <ActionMenu actions={actions} /> : null}
      {showAddJobModal ? (
        <AddJobModal
          queue={queue}
          variant="job"
          onDismiss={() => setShowAddJobModal(false)}
        />
      ) : null}

      {showAddSchedulerModal ? (
        <AddJobModal
          queue={queue}
          variant="scheduler"
          onDismiss={() => setShowAddSchedulerModal(false)}
        />
      ) : null}
    </>
  );
};
