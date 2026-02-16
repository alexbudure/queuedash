import type { Status } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { Layout } from "../components/Layout";
import { JobTable } from "../components/JobTable";
import { useEffect, useState } from "react";
import {
  JOBS_PER_PAGE,
  NUM_OF_RETRIES,
  REFETCH_INTERVAL,
} from "../utils/config";
import { Skeleton } from "../components/Skeleton";
import { ErrorCard } from "../components/ErrorCard";
import { QueueStatusTabs } from "../components/QueueStatusTabs";
import { QueueActionMenu } from "../components/QueueActionMenu";
import { useParams, useSearchParams } from "react-router";
import { SchedulerTable } from "../components/SchedulerTable";
import { MetricsSection } from "../components/MetricsSection";
import { GroupsSection } from "../components/GroupsSection";

export const { format: numberFormat } = new Intl.NumberFormat("en-US");

export const QueuePage = () => {
  const { id } = useParams();
  const queueName = id as string;

  const [searchParams] = useSearchParams();

  const [status, setStatus] = useState<Status>("completed");
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
      limit: JOBS_PER_PAGE,
      status,
      groupId: selectedGroupId ?? undefined,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      enabled: !!queueName,
      refetchInterval: REFETCH_INTERVAL,
      retry: NUM_OF_RETRIES,
    },
  );

  useEffect(() => {
    const searchStatus = searchParams.get("status");
    if (searchStatus) {
      setStatus(searchStatus as Status);
    }

    if (!searchStatus && status) {
      setStatus("completed");
    }
  }, [searchParams, status]);

  const queueReq = trpc.queue.byName.useQuery(
    {
      queueName,
    },
    {
      enabled: !!queueName,
      refetchInterval: REFETCH_INTERVAL,
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

  const jobs =
    data?.pages
      .map((page) => {
        return page.jobs;
      })
      .flat() ?? [];
  const totalJobs = data?.pages.at(-1)?.totalCount || 0;

  return (
    <Layout>
      {queueReq.data === null ? (
        <ErrorCard message="No queue found" />
      ) : isError ? (
        <ErrorCard message="Could not fetch jobs" />
      ) : (
        <div>
          <div className="mb-2 flex justify-between">
            <div className="flex items-center space-x-4">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                {queueReq.data ? (
                  queueReq.data.displayName
                ) : (
                  <Skeleton className="h-8 w-52 rounded-md" />
                )}
              </h1>
              <div className="flex items-center space-x-2">
                {queueReq.data ? (
                  <QueueActionMenu queue={queueReq.data} />
                ) : null}
                {queueReq.data?.paused ? (
                  <div className="flex h-7 cursor-default items-center justify-center space-x-1.5 rounded-md bg-yellow-50 px-2 text-sm font-medium text-yellow-900 transition duration-150 ease-in-out dark:bg-yellow-950/30 dark:text-yellow-400">
                    <span>Paused</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div className="mb-5">
            <div className="flex items-center space-x-2">
              {queueReq.data ? (
                <>
                  <p className="text-slate-600 dark:text-slate-400">
                    <span className="text-green-800 dark:text-green-400">
                      {numberFormat(queueReq.data.client.connectedClients)}{" "}
                      connected
                    </span>{" "}
                    and{" "}
                    <span className="text-red-800 dark:text-red-400">
                      {numberFormat(queueReq.data.client.blockedClients)}{" "}
                      blocked
                    </span>{" "}
                    out of{" "}
                    <span className="text-slate-900 dark:text-slate-100">
                      {numberFormat(queueReq.data.client.maxClients)} max
                      clients
                    </span>
                  </p>
                  <p className="text-slate-600 dark:text-slate-400">·</p>
                  <p className="text-slate-600 dark:text-slate-400">
                    {queueReq.data.client.usedMemoryHuman} /{" "}
                    {queueReq.data.client.totalMemoryHuman} (
                    {(queueReq.data.client.usedMemoryPercentage * 100).toFixed(
                      2,
                    )}
                    %)
                  </p>
                  <p className="text-slate-600 dark:text-slate-400">·</p>
                  <p className="text-slate-600 dark:text-slate-400">
                    Redis v{queueReq.data.client.version}
                  </p>
                </>
              ) : (
                <Skeleton className="h-6 w-80" />
              )}
            </div>
          </div>

          <div className="space-y-8">
            {queueReq.data?.supports.metrics ? (
              <MetricsSection queueName={queueName} />
            ) : null}

            {selectedGroupId && !queueReq.data?.supports.groups ? (
              <div className="flex items-center justify-between rounded-lg border border-purple-200 bg-purple-50 px-4 py-3 dark:border-purple-800/50 dark:bg-purple-950/30">
                <span className="text-sm font-medium text-purple-900 dark:text-purple-100">
                  Filtering by group:{" "}
                  <span className="font-mono">{selectedGroupId}</span>
                </span>
                <button
                  onClick={() => setSelectedGroupId(null)}
                  className="rounded-md bg-purple-100 px-2.5 py-1.5 text-xs font-medium text-purple-700 transition hover:bg-purple-200 dark:bg-purple-900/50 dark:text-purple-300 dark:hover:bg-purple-900"
                >
                  Clear filter
                </button>
              </div>
            ) : null}

            {queueReq.data?.supports.groups ? (
              <GroupsSection
                queueName={queueName}
                selectedGroupId={selectedGroupId}
                onSelectGroup={setSelectedGroupId}
              />
            ) : null}

            {queueReq.data?.supports.schedulers ? (
              <SchedulerTable queueName={queueName} />
            ) : null}

            <div className="space-y-4">
              <QueueStatusTabs
                showCleanAllButton={totalJobs > 0}
                queueName={queueName}
                status={status}
                queue={queueReq.data}
                totalJobs={totalJobs}
                selectedGroupId={selectedGroupId}
              />
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
              />
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};
