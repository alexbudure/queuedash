import { Loader2, Users } from "lucide-react";

import { trpc } from "../utils/trpc";
import { useQueuedash } from "./QueuedashProvider";

const formatSeconds = (value: number | undefined): string => {
  if (value === undefined) return "—";
  if (value < 60) return `${value}s`;
  if (value < 3_600) return `${Math.floor(value / 60)}m`;
  return `${Math.floor(value / 3_600)}h`;
};

export const WorkersSection = ({
  enabled,
  queueName,
}: {
  enabled: boolean;
  queueName: string;
}) => {
  const { preferences } = useQueuedash();
  const workersReq = trpc.queue.workers.useQuery(
    { queueName },
    {
      enabled,
      refetchInterval: preferences.refreshIntervalMs,
    },
  );

  if (!enabled) return null;

  return (
    <section className="rounded-xl border border-gray-100 p-3 dark:border-slate-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-gray-400 dark:text-slate-500" />
          <h2 className="text-xs font-semibold text-gray-700 dark:text-slate-300">
            Workers
          </h2>
        </div>
        <span className="font-mono text-xs text-gray-400 dark:text-slate-500">
          {workersReq.data?.length ?? 0}
        </span>
      </div>

      {workersReq.isLoading ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-gray-400 dark:text-slate-500">
          <Loader2 className="size-3.5 animate-spin" />
          Checking workers…
        </div>
      ) : workersReq.isError ? (
        <div className="mt-3 text-xs text-red-600 dark:text-red-400">
          Worker inspection is unavailable from this Redis server.
        </div>
      ) : workersReq.data?.length ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {workersReq.data.map((worker) => (
            <div
              key={worker.id}
              className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-slate-950/60"
            >
              <div className="truncate font-mono text-xs font-medium text-gray-800 dark:text-slate-200">
                {worker.name || `Worker ${worker.id}`}
              </div>
              <div className="mt-1 flex gap-3 text-[10px] text-gray-400 dark:text-slate-500">
                <span>age {formatSeconds(worker.ageSeconds)}</span>
                <span>idle {formatSeconds(worker.idleSeconds)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 text-xs text-gray-400 dark:text-slate-500">
          No active workers reported.
        </div>
      )}
    </section>
  );
};
