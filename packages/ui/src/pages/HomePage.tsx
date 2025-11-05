import { Layout } from "../components/Layout";
import { trpc } from "../utils/trpc";
import { NUM_OF_RETRIES, REFETCH_INTERVAL } from "../utils/config";
import { Link } from "react-router";
import {
  CheckCircledIcon,
  CrossCircledIcon,
  MinusCircledIcon,
  PauseIcon,
  PlayIcon,
  PlusCircledIcon,
} from "@radix-ui/react-icons";
import { Tooltip } from "../components/Tooltip";
import type { ReactNode } from "react";
import { ActionMenu } from "../components/ActionMenu";

type CountStatProps = {
  count: number;
  variant: "completed" | "failed" | "waiting" | "active";
};
const CountStat = ({ count, variant }: CountStatProps) => {
  const colorMap: Record<CountStatProps["variant"], string> = {
    active: "text-cyan-600 dark:text-cyan-400",
    completed: "text-green-600 dark:text-green-400",
    failed: "text-red-600 dark:text-red-400",
    waiting: "text-amber-600 dark:text-amber-400",
  };
  const iconMap: Record<CountStatProps["variant"], ReactNode> = {
    active: <PlusCircledIcon width={16} height={16} />,
    completed: <CheckCircledIcon width={16} height={16} />,
    failed: <CrossCircledIcon width={16} height={16} />,
    waiting: <MinusCircledIcon width={16} height={16} />,
  };
  return (
    <div>
      <Tooltip message={variant.charAt(0).toUpperCase() + variant.slice(1)}>
        <div
          className={`flex items-center space-x-1 text-sm ${colorMap[variant]}`}
        >
          <p className="text-lg">{count}</p>
          {iconMap[variant]}
        </div>
      </Tooltip>
    </div>
  );
};

const QueueCard = ({ queueName }: { queueName: string }) => {
  const queueReq = trpc.queue.byName.useQuery(
    {
      queueName,
    },
    {
      refetchInterval: REFETCH_INTERVAL,
      retry: NUM_OF_RETRIES,
    }
  );

  if (!queueReq.data) return null;

  return (
    <Link
      to={`../${queueReq.data.name}`}
      className="group flex items-center justify-between transition"
    >
      <div className="flex items-center space-x-2">
        <p className="py-3 text-lg font-medium text-slate-900 transition group-hover:text-brand-900 dark:text-slate-200 dark:group-hover:text-brand-100">
          {queueReq.data.displayName}
        </p>
        <div>
          {queueReq.data.paused ? (
            <div className="flex h-7 items-center justify-center space-x-1.5 rounded-md bg-yellow-50 px-2 text-sm font-medium text-yellow-900 transition duration-150 ease-in-out dark:bg-yellow-950/30 dark:text-yellow-400">
              <span>Paused</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex space-x-5">
        <CountStat count={queueReq.data.counts.completed} variant="completed" />
        <CountStat count={queueReq.data.counts.failed} variant="failed" />
        <CountStat count={queueReq.data.counts.active} variant="active" />
        <CountStat count={queueReq.data.counts.waiting} variant="waiting" />
      </div>
    </Link>
  );
};
export const HomePage = () => {
  const { data } = trpc.queue.list.useQuery();
  const { mutate: pauseAll } = trpc.queue.pauseAll.useMutation();
  const { mutate: resumeAll } = trpc.queue.resumeAll.useMutation();

  return (
    <Layout>
      <div className="xl:max-w-2xl">
        <div className="flex justify-between">
          <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-slate-50">
            Queues
          </h1>
          <div>
            <ActionMenu
              actions={[
                {
                  label: "Resume all",
                  icon: <PlayIcon />,
                  onSelect: () => resumeAll(),
                },
                {
                  label: "Pause all",
                  icon: <PauseIcon />,
                  onSelect: () => pauseAll(),
                },
              ]}
            />
          </div>
        </div>

        <div>
          {data?.map((queue, index) => {
            return (
              <div
                key={queue.name}
                className={
                  data?.length - 1 !== index
                    ? "border-b border-slate-100 dark:border-slate-700"
                    : ""
                }
              >
                <QueueCard key={queue.name} queueName={queue.name} />
              </div>
            );
          })}
        </div>
      </div>
    </Layout>
  );
};
