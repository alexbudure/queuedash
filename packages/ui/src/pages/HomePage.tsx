import { CirclePause, CirclePlay } from "lucide-react";

import { ActionMenu } from "../components/ActionMenu";
import { Layout } from "../components/Layout";
import { OverviewQueueCard } from "../components/OverviewQueueCard";
import { useQueuedash } from "../components/QueuedashProvider";
import { Skeleton } from "../components/Skeleton";
import { trpc } from "../utils/trpc";

export const HomePage = () => {
  const { preferences } = useQueuedash();
  const { data, isLoading } = trpc.queue.list.useQuery(undefined, {
    refetchInterval: preferences.refreshIntervalMs,
  });
  const { mutate: pauseAll } = trpc.queue.pauseAll.useMutation();
  const { mutate: resumeAll } = trpc.queue.resumeAll.useMutation();
  const queues = data
    ? [...data].sort((left, right) => {
        const leftPinned = preferences.pinnedQueues.includes(left.name);
        const rightPinned = preferences.pinnedQueues.includes(right.name);
        if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
        return left.displayName.localeCompare(right.displayName);
      })
    : undefined;
  const actions = [
    ...(data?.some(
      (queue) => queue.supports.resume && queue.access.actions["queue.resume"],
    )
      ? [
          {
            label: "Resume all",
            icon: <CirclePlay className="size-3.5" />,
            onSelect: () => resumeAll(),
          },
        ]
      : []),
    ...(data?.some(
      (queue) => queue.supports.pause && queue.access.actions["queue.pause"],
    )
      ? [
          {
            label: "Pause all",
            icon: <CirclePause className="size-3.5" />,
            onSelect: () => pauseAll(),
          },
        ]
      : []),
  ];

  return (
    <Layout>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
          Overview
        </h1>
        {actions.length > 0 ? <ActionMenu actions={actions} /> : null}
      </div>

      <div className="mt-4 flex max-w-3xl flex-col gap-1.5">
        {isLoading
          ? [...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))
          : queues?.map((queue) => (
              <OverviewQueueCard key={queue.name} queueName={queue.name} />
            ))}
      </div>
    </Layout>
  );
};
