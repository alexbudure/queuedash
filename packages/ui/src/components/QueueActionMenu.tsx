import { Pause, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { formatCountLabel } from "../utils/format";
import { mutationToasts } from "../utils/mutationToasts";
import type { Queue } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { ActionMenu } from "./ActionMenu";
import { AddJobModal } from "./AddJobModal";
import { Alert } from "./Alert";
import { Button } from "./Button";

/** Whether this viewer gets the Pause/Resume button for `queue`. */
export const canToggleQueueRunning = (queue: Queue) =>
  queue.supports.pause &&
  queue.supports.resume &&
  (queue.paused
    ? queue.access.actions["queue.resume"]
    : queue.access.actions["queue.pause"]);

type QueueActionMenuProps = {
  queue: Queue;
};
export const QueueActionMenu = ({ queue }: QueueActionMenuProps) => {
  const { mutate: pause, isPending: isPausing } = trpc.queue.pause.useMutation(
    mutationToasts("Queue paused"),
  );
  const { mutate: resume, isPending: isResuming } =
    trpc.queue.resume.useMutation(mutationToasts("Queue resumed"));
  const { mutate: empty, isPending: isEmptying } = trpc.queue.empty.useMutation(
    mutationToasts("Queue emptied"),
  );
  const [showAddJobModal, setShowAddJobModal] = useState(false);
  const [showAddSchedulerModal, setShowAddSchedulerModal] = useState(false);
  const [confirm, setConfirm] = useState<"empty" | null>(null);
  const input = {
    queueName: queue.name,
  };
  const allowed = queue.access.actions;

  // What `empty` actually drains: the jobs that have not started yet.
  const pendingCount =
    queue.counts.waiting +
    queue.counts.delayed +
    queue.counts.prioritized +
    queue.counts.paused;

  // Whether a queue is running is the state the header reports, so the action
  // that changes it is promoted out of the menu rather than hidden one click
  // behind an unlabelled kebab. While paused, the amber Resume button is that
  // report - the header only shows a Paused pill where this button isn't.
  const runningAction = canToggleQueueRunning(queue)
    ? {
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
      }
    : null;

  // Build actions array based on what the queue supports
  const overflowActions = [
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
            label: "Empty queue",
            // A MenuItem closes the menu as it fires, so the confirmation lives
            // outside the menu and is armed from here.
            onSelect: () => setConfirm("empty"),
            icon: <Trash2 size={15} />,
            tone: "destructive" as const,
          },
        ]
      : []),
  ];

  const isRunningActionPending = isPausing || isResuming;

  return (
    <>
      {/* Desktop: Pause/Resume stays visible, everything else folds away. */}
      <div className="hidden items-center gap-2 sm:flex">
        {runningAction ? (
          <Button
            size="sm"
            colorScheme={queue.paused ? "yellow" : "slate"}
            label={runningAction.label}
            icon={runningAction.icon}
            isLoading={isRunningActionPending}
            onClick={runningAction.onSelect}
          />
        ) : null}

        {overflowActions.length > 0 ? (
          <ActionMenu
            actions={overflowActions}
            ariaLabel="More queue actions"
          />
        ) : null}
      </div>

      {/* Mobile: everything in dropdown */}
      {runningAction || overflowActions.length > 0 ? (
        <div className="sm:hidden">
          <ActionMenu
            actions={
              runningAction
                ? [runningAction, ...overflowActions]
                : overflowActions
            }
            isDisabled={isRunningActionPending}
            ariaLabel="Queue actions"
          />
        </div>
      ) : null}
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

      <Alert
        isOpen={confirm === "empty"}
        onOpenChange={(isOpen) => {
          if (!isOpen) setConfirm(null);
        }}
        isPending={isEmptying}
        title={`Empty ${queue.displayName}?`}
        description={`This permanently removes every job that has not started yet — ${formatCountLabel(
          pendingCount,
          "job",
        )} right now. Active and completed jobs are left alone. It cannot be undone.`}
        action={
          <Button
            variant="filled"
            colorScheme="red"
            label="Empty queue"
            onClick={() => empty(input, { onSettled: () => setConfirm(null) })}
          />
        }
      />
    </>
  );
};
