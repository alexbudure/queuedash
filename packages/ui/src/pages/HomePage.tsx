import { Layout } from "../components/Layout";
import { trpc } from "../utils/trpc";
import { NUM_OF_RETRIES, REFETCH_INTERVAL } from "../utils/config";
import { Link } from "react-router-dom";
import {
  CheckCircledIcon,
  CrossCircledIcon,
  MinusCircledIcon,
  PlusCircledIcon,
} from "@radix-ui/react-icons";
import { Tooltip } from "../components/Tooltip";
import type { ReactNode } from "react";

type CountStatProps = {
  count: number;
  variant: "completed" | "failed" | "waiting" | "active";
};
const CountStat = ({ count, variant }: CountStatProps) => {
  const colorMap: Record<CountStatProps["variant"], string> = {
    active: "text-cyan-600",
    completed: "text-green-600",
    failed: "text-red-600",
    waiting: "text-amber-600",
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
          <p className="text-lg">{count}</p> {iconMap[variant]}
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
      queryKey: ["queue.byName", { queueName }],
      refetchInterval: REFETCH_INTERVAL,
      retry: NUM_OF_RETRIES,
    },
  );

  if (!queueReq.data) return null;

  return (
    <Link
      to={`../${queueReq.data.name}`}
      className="group flex items-center justify-between transition"
    >
      <p className="py-3 text-lg font-medium text-slate-900 transition group-hover:text-brand-900 dark:text-slate-200 dark:group-hover:text-brand-100">
        {queueReq.data.displayName}
      </p>
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

  return (
    <Layout>
      <div>
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-slate-50">
          Queues
        </h1>
        <div className="xl:max-w-2xl">
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
