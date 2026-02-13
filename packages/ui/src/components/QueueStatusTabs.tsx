import { Link } from "react-router";
import { clsx } from "clsx";
import { Button } from "./Button";
import { TrashIcon, ReloadIcon } from "@radix-ui/react-icons";
import type { RouterOutput, Status } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { Alert } from "./Alert";
import { toast } from "sonner";

type Tab = {
  name: string;
  status: Status;
};

type QueueStatusTabsProps = {
  showCleanAllButton: boolean;
  status: Status;
  queueName: string;
  queue?: RouterOutput["queue"]["byName"];
  /** Job IDs for bulk operations */
  jobIds?: string[];
};
export const QueueStatusTabs = ({
  showCleanAllButton,
  queueName,
  status,
  queue,
  jobIds = [],
}: QueueStatusTabsProps) => {
  const { mutate: cleanQueue, status: cleanQueueStatus } =
    trpc.queue.clean.useMutation({
      onSuccess() {
        toast.success(`All ${status} jobs have been removed`);
      },
    });

  const { mutate: bulkRetry, status: bulkRetryStatus } =
    trpc.job.bulkRetry.useMutation({
      onSuccess(data) {
        toast.success(
          `Retried ${data.succeeded} job${data.succeeded !== 1 ? "s" : ""}${data.failed > 0 ? `, ${data.failed} failed` : ""}`,
        );
      },
      onError(error) {
        toast.error(error.message || "Failed to retry jobs");
      },
    });

  const tabs: Tab[] = [
    {
      name: "Completed",
      status: "completed",
    },
    {
      name: "Failed",
      status: "failed",
    },
    {
      name: "Active",
      status: "active",
    },
    ...(queue?.supports.priorities
      ? [{ name: "Prioritized", status: "prioritized" as const }]
      : []),
    {
      name: "Waiting",
      status: "waiting",
    },
    ...(queue?.supports.flows
      ? [{ name: "Waiting Children", status: "waiting-children" as const }]
      : []),
    {
      name: "Delayed",
      status: "delayed",
    },
    ...(queue?.supports.pause
      ? [{ name: "Paused", status: "paused" as const }]
      : []),
  ];

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-3">
        {tabs.map((tab) => {
          const isActive = tab.status === status;
          return (
            <Link
              to={`?status=${tab.status}`}
              key={tab.name}
              className={clsx(
                "flex items-center space-x-2 rounded-md px-3 py-1 font-medium transition duration-150 ease-in-out",
                {
                  "text-slate-500 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800":
                    !isActive,
                  "bg-green-50 text-green-900 dark:bg-green-900 dark:text-green-50":
                    isActive && tab.status === "completed",
                  "bg-red-50 text-red-900 dark:bg-red-900 dark:text-red-100":
                    isActive && tab.status === "failed",
                  "bg-cyan-50 text-cyan-900 dark:bg-cyan-900 dark:text-cyan-50":
                    isActive && tab.status === "active",
                  "bg-purple-50 text-purple-900 dark:bg-purple-900 dark:text-purple-50":
                    isActive && tab.status === "prioritized",
                  "bg-amber-50 text-amber-900 dark:bg-amber-900 dark:text-amber-50":
                    isActive && tab.status === "waiting",
                  "bg-orange-50 text-orange-900 dark:bg-orange-900 dark:text-orange-50":
                    isActive && tab.status === "waiting-children",
                  "bg-indigo-50 text-indigo-900 dark:bg-indigo-900 dark:text-indigo-50":
                    isActive && tab.status === "delayed",
                  "bg-stone-50 text-stone-900 dark:bg-stone-900 dark:text-stone-50":
                    isActive && tab.status === "paused",
                },
              )}
            >
              <span>{tab.name}</span>
              {queue?.counts[tab.status] ? (
                <span
                  className={clsx(
                    "rounded-md px-1.5 py-0.5 text-xs font-semibold",
                    {
                      "bg-slate-400 text-slate-50 dark:bg-slate-600 dark:text-slate-100": !isActive,
                      "bg-green-600 text-green-50 dark:bg-green-700 dark:text-green-100":
                        isActive && tab.status === "completed",
                      "bg-red-600 text-red-50 dark:bg-red-700 dark:text-red-100":
                        isActive && tab.status === "failed",
                      "bg-cyan-600 text-cyan-50 dark:bg-cyan-700 dark:text-cyan-100":
                        isActive && tab.status === "active",
                      "bg-purple-600 text-purple-50 dark:bg-purple-700 dark:text-purple-100":
                        isActive && tab.status === "prioritized",
                      "bg-amber-600 text-amber-50 dark:bg-amber-700 dark:text-amber-100":
                        isActive && tab.status === "waiting",
                      "bg-orange-600 text-orange-50 dark:bg-orange-700 dark:text-orange-100":
                        isActive && tab.status === "waiting-children",
                      "bg-indigo-600 text-indigo-50 dark:bg-indigo-700 dark:text-indigo-100":
                        isActive && tab.status === "delayed",
                      "bg-stone-600 text-stone-50 dark:bg-stone-700 dark:text-stone-100":
                        isActive && tab.status === "paused",
                    },
                  )}
                >
                  {queue.counts[tab.status]}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        {/* Retry All button - only for failed jobs */}
        {showCleanAllButton &&
        status === "failed" &&
        queue?.supports.retry &&
        jobIds.length > 0 ? (
          <Alert
            title="Retry all failed jobs?"
            description={`This will retry ${jobIds.length} failed job${jobIds.length !== 1 ? "s" : ""}. Jobs will be moved back to waiting state.`}
            action={
              <Button
                variant="filled"
                colorScheme="blue"
                label="Yes, retry all"
                onClick={() =>
                  bulkRetry({
                    queueName,
                    jobIds,
                  })
                }
              />
            }
          >
            <Button
              colorScheme="blue"
              icon={<ReloadIcon />}
              label="Retry all"
              size="sm"
              isLoading={bulkRetryStatus === "pending"}
            />
          </Alert>
        ) : null}

        {/* Clean All button */}
        {showCleanAllButton &&
        status !== "waiting-children" &&
        queue?.supports.clean ? (
          <Alert
            title="Are you absolutely sure?"
            description={`This action cannot be undone. This will permanently remove all ${status} jobs from the queue.`}
            action={
              <Button
                variant="filled"
                colorScheme="red"
                label="Yes, remove jobs"
                onClick={() =>
                  cleanQueue({
                    queueName,
                    status,
                  })
                }
              />
            }
          >
            <Button
              colorScheme="yellow"
              icon={<TrashIcon />}
              label="Clean all"
              size="sm"
              isLoading={cleanQueueStatus === "pending"}
            />
          </Alert>
        ) : null}
      </div>
    </div>
  );
};
