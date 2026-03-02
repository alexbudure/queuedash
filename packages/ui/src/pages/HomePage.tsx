import { Layout } from "../components/Layout";
import { trpc } from "../utils/trpc";
import { CirclePause, CirclePlay } from "lucide-react";
import { ActionMenu } from "../components/ActionMenu";
import { OverviewQueueCard } from "../components/OverviewQueueCard";
import { Skeleton } from "../components/Skeleton";

export const HomePage = () => {
  const { data, isLoading } = trpc.queue.list.useQuery();
  const { mutate: pauseAll } = trpc.queue.pauseAll.useMutation();
  const { mutate: resumeAll } = trpc.queue.resumeAll.useMutation();

  return (
    <Layout>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
          Overview
        </h1>
        <ActionMenu
          actions={[
            {
              label: "Resume all",
              icon: <CirclePlay className="size-3.5" />,
              onSelect: () => resumeAll(),
            },
            {
              label: "Pause all",
              icon: <CirclePause className="size-3.5" />,
              onSelect: () => pauseAll(),
            },
          ]}
        />
      </div>

      <div className="mt-4 flex max-w-3xl flex-col gap-1.5">
        {isLoading
          ? [...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))
          : data?.map((queue: { name: string }) => (
              <OverviewQueueCard key={queue.name} queueName={queue.name} />
            ))}
      </div>
    </Layout>
  );
};
