import { LockKeyhole, Star } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Key } from "react-aria-components";
import { useParams, useSearchParams } from "react-router";

import { ErrorCard } from "../components/ErrorCard";
import { GroupsSection } from "../components/GroupsSection";
import { JobSearch } from "../components/JobSearch";
import { JobTable } from "../components/JobTable";
import { Layout } from "../components/Layout";
import { MetricsSection } from "../components/MetricsSection";
import { QueueActionMenu } from "../components/QueueActionMenu";
import { useQueuedash } from "../components/QueuedashProvider";
import { QueueStatusTabs } from "../components/QueueStatusTabs";
import { SchedulerTable } from "../components/SchedulerTable";
import { Skeleton } from "../components/Skeleton";
import { WorkersSection } from "../components/WorkersSection";
import { NUM_OF_RETRIES } from "../utils/config";
import type { Status } from "../utils/trpc";
import { trpc } from "../utils/trpc";

export const { format: numberFormat } = new Intl.NumberFormat("en-US");
const VALID_STATUSES: Status[] = [
  "completed",
  "failed",
  "active",
  "prioritized",
  "waiting",
  "waiting-children",
  "delayed",
  "paused",
];

export const QueuePage = () => {
  const { preferences, setLastJobStatus, togglePinnedQueue } = useQueuedash();
  const { id } = useParams();
  const queueName = id as string;

  const [searchParams, setSearchParams] = useSearchParams();

  const isSchedulersView = searchParams.get("view") === "schedulers";
  const preferredStatus =
    preferences.defaultJobStatus === "remember"
      ? preferences.lastJobStatus
      : preferences.defaultJobStatus;
  const initialStatus = searchParams.get("status");
  const [status, setStatus] = useState<Status>(
    initialStatus && VALID_STATUSES.includes(initialStatus as Status)
      ? (initialStatus as Status)
      : preferredStatus,
  );

  const handleTabChange = useCallback(
    (key: Key) => {
      const k = String(key);
      if (k === "schedulers") {
        setSearchParams({ view: "schedulers" });
      } else {
        setLastJobStatus(k as Status);
        setSearchParams({ status: k });
      }
    },
    [setLastJobStatus, setSearchParams],
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const {
    data,
    fetchNextPage,
    isLoading,
    isError,
    isFetchingNextPage,
    hasNextPage,
  } = trpc.job.list.useInfiniteQuery(
    {
      queueName,
      limit: preferences.jobsPerPage,
      status,
      groupId: selectedGroupId ?? undefined,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      enabled: !!queueName && !isSchedulersView,
      refetchInterval: preferences.refreshIntervalMs,
      retry: NUM_OF_RETRIES,
    },
  );

  useEffect(() => {
    const searchStatus = searchParams.get("status");
    if (searchStatus && VALID_STATUSES.includes(searchStatus as Status)) {
      const nextStatus = searchStatus as Status;
      if (nextStatus !== status) {
        setStatus(nextStatus);
      }
      return;
    }

    if (!searchStatus && !isSchedulersView && status !== preferredStatus) {
      setStatus(preferredStatus);
    }
  }, [searchParams, isSchedulersView, preferredStatus, status]);

  const queueReq = trpc.queue.byName.useQuery(
    {
      queueName,
    },
    {
      enabled: !!queueName,
      refetchInterval: preferences.refreshIntervalMs,
      retry: NUM_OF_RETRIES,
    },
  );

  useEffect(() => {
    setSelectedGroupId(null);
  }, [queueName]);

  useEffect(() => {
    if (queueReq.data && !queueReq.data.supports.groups && selectedGroupId) {
      setSelectedGroupId(null);
    }
  }, [queueReq.data, selectedGroupId]);

  const schedulersReq = trpc.scheduler.list.useQuery(
    { queueName },
    {
      enabled: !!queueName && !!queueReq.data?.supports.schedulers,
      refetchInterval: preferences.refreshIntervalMs,
      retry: NUM_OF_RETRIES,
    },
  );

  const jobs =
    data?.pages
      .map((page) => {
        return page.jobs;
      })
      .flat() ?? [];
  const totalJobs = data?.pages.at(-1)?.totalCount || 0;
  const redisStatus =
    queueReq.data === null ? null : (
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {queueReq.data ? (
          <>
            <p className="flex flex-wrap items-center gap-1.5 font-mono text-gray-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5 text-green-700 dark:text-green-400">
                <span className="size-1.5 rounded-full bg-green-500" />
                {numberFormat(queueReq.data.client.connectedClients)} connected
              </span>
              <span className="text-gray-400 dark:text-slate-500">and</span>
              <span className="inline-flex items-center gap-1.5 text-red-700 dark:text-red-400">
                <span className="size-1.5 rounded-full bg-red-500" />
                {numberFormat(queueReq.data.client.blockedClients)} blocked
              </span>
              <span>
                out of {numberFormat(queueReq.data.client.maxClients)} max
                clients
              </span>
            </p>

            <p className="font-mono text-gray-500 dark:text-slate-400">
              Redis v{queueReq.data.client.version} ·{" "}
              {queueReq.data.client.usedMemoryHuman} /{" "}
              {queueReq.data.client.totalMemoryHuman} (
              {(queueReq.data.client.usedMemoryPercentage * 100).toFixed(2)}
              %) ·{" "}
              {{
                bull: "Bull",
                bullmq: "BullMQ",
                groupmq: "GroupMQ",
                bee: "BeeQueue",
              }[queueReq.data.type] ?? queueReq.data.type}
            </p>
          </>
        ) : (
          <div className="flex w-full items-center justify-between gap-4">
            <Skeleton className="h-4 w-56 rounded" />
            <Skeleton className="h-4 w-44 rounded" />
          </div>
        )}
      </div>
    );

  return (
    <Layout top={redisStatus}>
      {queueReq.data === null ? (
        <ErrorCard message="No queue found" />
      ) : isError ? (
        <ErrorCard message="Could not fetch jobs" />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
                {queueReq.data ? (
                  queueReq.data.displayName
                ) : (
                  <Skeleton className="h-7 w-40 rounded" />
                )}
              </h1>
              <div className="flex items-center gap-2">
                {queueReq.data ? (
                  <button
                    type="button"
                    onClick={() => togglePinnedQueue(queueName)}
                    aria-label={`${preferences.pinnedQueues.includes(queueName) ? "Unpin" : "Pin"} ${queueReq.data.displayName}`}
                    title={`${preferences.pinnedQueues.includes(queueName) ? "Unpin" : "Pin"} queue`}
                    className="flex size-7 items-center justify-center rounded-md text-gray-300 transition hover:bg-gray-100 hover:text-amber-500 dark:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-amber-400"
                  >
                    <Star
                      className="size-3.5"
                      fill={
                        preferences.pinnedQueues.includes(queueName)
                          ? "currentColor"
                          : "none"
                      }
                    />
                  </button>
                ) : null}
                {queueReq.data ? (
                  <QueueActionMenu queue={queueReq.data} />
                ) : null}
                {queueReq.data?.access.mode === "read-only" ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-gray-100 px-2 py-px text-[10px] font-medium text-gray-600 dark:bg-slate-800 dark:text-slate-300">
                    <LockKeyhole className="size-2.5" />
                    Read-only
                  </span>
                ) : null}
                {queueReq.data?.paused ? (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-px text-[10px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
                    Paused
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <JobSearch queueName={queueName} />

          {queueReq.isLoading ? (
            <div className="space-y-4 pb-2">
              <Skeleton className="h-[30px] w-72 rounded-lg" />
              <div className="grid h-[196px] grid-cols-2 gap-6 sm:h-[90px] sm:grid-cols-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i}>
                    <Skeleton className="h-4 w-16 rounded" />
                    <Skeleton className="mt-1 h-7 w-16 rounded" />
                    <Skeleton className="mt-0.5 h-4 w-12 rounded" />
                    <Skeleton className="mt-2 h-6 w-full rounded" />
                  </div>
                ))}
              </div>
            </div>
          ) : queueReq.data?.supports.metrics ? (
            <div className="pb-2">
              <MetricsSection queueName={queueName} />
            </div>
          ) : null}

          <WorkersSection
            queueName={queueName}
            enabled={queueReq.data?.supports.workers === true}
          />

          {selectedGroupId && !queueReq.data?.supports.groups ? (
            <div className="flex items-center justify-between rounded-lg bg-purple-50/80 px-3 py-2 dark:bg-purple-950/30">
              <span className="text-xs font-medium text-purple-900 dark:text-purple-100">
                Filtering by group:{" "}
                <span className="font-mono">{selectedGroupId}</span>
              </span>
              <button
                onClick={() => setSelectedGroupId(null)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-purple-600 transition-colors hover:bg-purple-100 dark:text-purple-400 dark:hover:bg-purple-900/50"
              >
                Clear
              </button>
            </div>
          ) : null}

          {queueReq.data?.supports.groups ? (
            <GroupsSection
              canRemoveJobs={queueReq.data.access.actions["job.remove"]}
              queueName={queueName}
              selectedGroupId={selectedGroupId}
              onSelectGroup={setSelectedGroupId}
            />
          ) : null}

          <div className="space-y-3">
            <QueueStatusTabs
              status={status}
              queue={queueReq.data}
              isSchedulersView={isSchedulersView}
              schedulerCount={schedulersReq.data?.length}
              onTabChange={handleTabChange}
            />
            {isSchedulersView ? (
              <SchedulerTable
                canRemove={
                  queueReq.data?.access.actions["scheduler.remove"] === true
                }
                queueName={queueName}
              />
            ) : (
              <JobTable
                onBottomInView={() => {
                  if (isFetchingNextPage || !hasNextPage) return;
                  fetchNextPage();
                }}
                status={status}
                totalJobs={totalJobs}
                jobs={jobs.map((j) => ({ ...j, status }))}
                isLoading={isLoading}
                isFetchingNextPage={isFetchingNextPage}
                queueName={queueName}
                queue={queueReq.data}
                selectedGroupId={selectedGroupId}
              />
            )}
          </div>
        </div>
      )}
    </Layout>
  );
};
