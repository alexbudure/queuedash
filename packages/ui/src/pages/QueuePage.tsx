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
import { CircleNumber } from "../components/CircleNumber";

export const { format: numberFormat } = new Intl.NumberFormat("en-US");

export const QueuePage = () => {
  const { id } = useParams();
  const queueName = id as string;

  const [searchParams] = useSearchParams();

  const [status, setStatus] = useState<Status>("completed");
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

  const jobs =
    data?.pages
      .map((page) => {
        return page.jobs;
      })
      .flat() ?? [];

    
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
                  <div className="flex h-7 cursor-default items-center justify-center space-x-1.5 rounded-md bg-yellow-50 px-2 text-sm font-medium text-yellow-900 transition duration-150 ease-in-out">
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
                  <p className="text-slate-600">
                    <span className="text-green-800">
                      {numberFormat(queueReq.data.client.connectedClients)}{" "}
                      connected
                    </span>{" "}
                    and{" "}
                    <span className="text-red-800">
                      {numberFormat(queueReq.data.client.blockedClients)}{" "}
                      blocked
                    </span>{" "}
                    out of{" "}
                    <span className="text-slate-900">
                      {numberFormat(queueReq.data.client.maxClients)} max
                      clients
                    </span>
                  </p>
                  <p className="text-slate-600">·</p>
                  <p className="text-slate-600">
                    {queueReq.data.client.usedMemoryHuman} /{" "}
                    {queueReq.data.client.totalMemoryHuman} (
                    {(queueReq.data.client.usedMemoryPercentage * 100).toFixed(
                      2,
                    )}
                    %)
                  </p>
                  <p className="text-slate-600">·</p>
                  <p className="text-slate-600">
                    Redis v{queueReq.data.client.version}
                  </p>
                </>
              ) : (
                <Skeleton className="h-6 w-80" />
              )}
            </div>
          </div>
     
          <div className="mb-5">
  <div className="flex items-center space-x-2">
    {queueReq.data?.counts?.completedLastMinute !== undefined &&(
      <CircleNumber number={Number(queueReq.data.counts.completedLastMinute)} label="Completed last minute" />
    )}
    {queueReq.data?.counts?.failedLastMinute !== undefined &&  (
      <CircleNumber number={Number(queueReq.data.counts.failedLastMinute)}   label="Failed last minute"/>
    )}
    {queueReq.data?.counts?.completedLastHour !== undefined &&  (
      <CircleNumber number={Number(queueReq.data.counts.completedLastHour)}  label="Completed last hour"/>
    )}
    {queueReq.data?.counts?.failedLastHour !== undefined &&  (
      <CircleNumber number={Number(queueReq.data.counts.failedLastHour)}  label="Failed last hour"/>
    )}
    
  </div>
</div>
         
              
          <div className="space-y-4">
            <QueueStatusTabs
              showCleanAllButton={jobs.length > 0}
              queueName={queueName}
              status={status}
              queue={queueReq.data}
            />
            <JobTable
              onBottomInView={() => {
                if (isFetchingNextPage || !hasNextPage) return;
                fetchNextPage();
              }}
              status={status}
              totalJobs={data?.pages.at(-1)?.totalCount || 0}
              jobs={jobs.map((j) => ({ ...j, status }))}
              isLoading={isLoading}
              isFetchingNextPage={isFetchingNextPage}
              queueName={queueName}
            />
          </div>
        </div>
      )}
    </Layout>
  );
};
