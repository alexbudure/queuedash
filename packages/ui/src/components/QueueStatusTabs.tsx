import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { Button } from "./Button";
import { TrashIcon } from "@radix-ui/react-icons";
import type { Status, RouterOutput } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { Toast } from "./Toast";
import { Alert } from "./Alert";

type Tab = {
  name: string;
  status: Status;
};

type QueueStatusTabsProps = {
  showCleanAllButton: boolean;
  status: Status;
  queueName: string;
  queue?: RouterOutput["queue"]["byName"];
};
export const QueueStatusTabs = ({
  showCleanAllButton,
  queueName,
  status,
  queue,
}: QueueStatusTabsProps) => {
  const {
    mutate: cleanQueue,
    isLoading: isLoadingCleanQueue,
    isSuccess: isSuccessCleanQueue,
  } = trpc.queue.clean.useMutation();

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
    ...(queue && "prioritized" in queue.counts
      ? [{ name: "Prioritized", status: "prioritized" as const }]
      : []),
    {
      name: "Waiting",
      status: "waiting",
    },
    {
      name: "Delayed",
      status: "delayed",
    },
    {
      name: "Paused",
      status: "paused",
    },
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
                  "bg-cyan-50 text-cyan-900":
                    isActive && tab.status === "active",
                  "bg-purple-50 text-purple-900":
                    isActive && tab.status === "prioritized",
                  "bg-amber-50 text-amber-900":
                    isActive && tab.status === "waiting",
                  "bg-indigo-50 text-indigo-900":
                    isActive && tab.status === "delayed",
                  "bg-stone-50 text-stone-900":
                    isActive && tab.status === "paused",
                }
              )}
            >
              <span>{tab.name}</span>
              {queue?.counts[tab.status] ? (
                <span
                  className={clsx(
                    "rounded-md py-0.5 px-1.5 text-xs font-semibold",
                    {
                      "bg-slate-400 text-slate-50": !isActive,
                      "bg-green-600 text-green-50":
                        isActive && tab.status === "completed",
                      "bg-red-600 text-red-50":
                        isActive && tab.status === "failed",
                      "bg-cyan-600 text-cyan-50":
                        isActive && tab.status === "active",
                      "bg-purple-600 text-purple-50":
                        isActive && tab.status === "prioritized",
                      "bg-amber-600 text-amber-50":
                        isActive && tab.status === "waiting",
                      "bg-indigo-600 text-indigo-50":
                        isActive && tab.status === "delayed",
                      "bg-stone-600 text-stone-50":
                        isActive && tab.status === "paused",
                    }
                  )}
                >
                  {queue.counts[tab.status]}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
      {showCleanAllButton ? (
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
            isLoading={isLoadingCleanQueue}
          />
        </Alert>
      ) : null}
      {isSuccessCleanQueue ? (
        <Toast
          message={`All ${status} jobs have been removed`}
          variant="success"
        />
      ) : null}
    </div>
  );
};
