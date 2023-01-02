import type { Job, Status } from "../utils/trpc";
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
import { JobOptionTag } from "../components/JobOptionTag";
import { useParams, useSearchParams } from "react-router-dom";

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
    }
  );
  //
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
    }
  );

  const jobs: Job[] =
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
          <div className="mb-6 flex items-center space-x-4">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
              {queueReq.data ? (
                queueReq.data.displayName
              ) : (
                <Skeleton className="h-8 w-52 rounded-md" />
              )}
            </h1>

            {queueReq.data ? <QueueActionMenu queue={queueReq.data} /> : null}
            {/*TODO:*/}
            {queueReq.data?.paused ? <JobOptionTag label="Paused" /> : null}
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

/**
 * TODO: High priority
 *   - Redis client options
 *   - Reassure when cleaning all (test wait)
 *   - Resume / pause / add queue
 *   - Toast for confirmation
 *
 * TODO: Before launch
 *   - Error screens
 *   - Offline indicator
 *   - Premium button
 *   - +1 to dates like plane tickets and add year if not this year
 */
