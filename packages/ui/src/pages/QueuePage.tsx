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
import {
  getJobListRefetchInterval,
  type JobSort,
  shouldWriteEffectiveStatus,
  updateJobQueryParams,
  updateJobSortParams,
} from "../utils/viewState";

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

  const requestedSchedulersView = searchParams.get("view") === "schedulers";
  const rawQuery = searchParams.get("q")?.trim() ?? "";
  const query = rawQuery.slice(0, 200);
  const requestedSort = searchParams.get("sort");
  const sort: JobSort =
    requestedSort === "newest" || requestedSort === "oldest"
      ? requestedSort
      : "queue";
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

  useEffect(() => {
    if (rawQuery.length <= 200) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("q", query);
        return next;
      },
      { replace: true },
    );
  }, [query, rawQuery.length, setSearchParams]);

  const handleTabChange = useCallback(
    (key: Key) => {
      const k = String(key);
      if (k !== "schedulers") {
        setLastJobStatus(k as Status);
      }
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (k === "schedulers") {
          next.set("view", "schedulers");
          next.delete("status");
        } else {
          next.set("status", k);
          next.delete("view");
        }
        return next;
      });
    },
    [setLastJobStatus, setSearchParams],
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
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
  const isSchedulersView =
    requestedSchedulersView && queueReq.data?.supports.schedulers !== false;

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
      query: query || undefined,
      sort,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      enabled:
        !!queueName &&
        !isSchedulersView &&
        !!queueReq.data &&
        queueReq.data.supports.statuses.includes(status),
      refetchInterval: (queryState) =>
        getJobListRefetchInterval(
          (queryState.state.data as { pages?: readonly unknown[] } | undefined)
            ?.pages?.length ?? 0,
          preferences.refreshIntervalMs,
        ),
      retry: NUM_OF_RETRIES,
    },
  );

  useEffect(() => {
    const searchStatus = searchParams.get("status");
    const requestedStatus =
      searchStatus && VALID_STATUSES.includes(searchStatus as Status)
        ? (searchStatus as Status)
        : preferredStatus;
    const supportedStatuses = queueReq.data?.supports.statuses;
    const nextStatus = (
      supportedStatuses && !supportedStatuses.includes(requestedStatus)
        ? supportedStatuses.includes("completed")
          ? "completed"
          : (supportedStatuses[0] ?? requestedStatus)
        : requestedStatus
    ) as Status;

    if (nextStatus !== status) {
      setStatus(nextStatus);
    }

    if (
      supportedStatuses &&
      shouldWriteEffectiveStatus({
        effectiveStatus: nextStatus,
        isSchedulersView,
        params: searchParams,
      })
    ) {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("status", nextStatus);
          return next;
        },
        { replace: true },
      );
    }
  }, [
    isSchedulersView,
    preferredStatus,
    queueReq.data?.supports.statuses,
    searchParams,
    setSearchParams,
    status,
  ]);

  useEffect(() => {
    if (
      !requestedSchedulersView ||
      !queueReq.data ||
      queueReq.data.supports.schedulers
    ) {
      return;
    }

    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("view");
        return next;
      },
      { replace: true },
    );
  }, [queueReq.data, requestedSchedulersView, setSearchParams]);

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
  const firstPage = data?.pages[0];
  const searchMeta =
    firstPage && "searchMeta" in firstPage ? firstPage.searchMeta : undefined;
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
      {queueReq.isError ? (
        <ErrorCard
          message={
            queueReq.error.data?.code === "NOT_FOUND"
              ? "No queue found"
              : "Could not fetch queue"
          }
        />
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
            {!isSchedulersView ? (
              <JobSearch
                query={query}
                sort={sort}
                searchMeta={searchMeta}
                isLoading={isLoading}
                onQueryChange={(nextQuery) => {
                  setSearchParams((current) =>
                    updateJobQueryParams(current, status, nextQuery),
                  );
                }}
                onSortChange={(nextSort) => {
                  setSearchParams((current) =>
                    updateJobSortParams(current, status, nextSort),
                  );
                }}
              />
            ) : null}
            {isSchedulersView ? (
              <SchedulerTable
                canRemove={
                  queueReq.data?.access.actions["scheduler.remove"] === true
                }
                queue={queueReq.data}
                queueName={queueName}
              />
            ) : isError ? (
              <ErrorCard message="Could not fetch jobs" />
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
                query={query || undefined}
                searchIsPartial={searchMeta?.capped === true}
              />
            )}
          </div>
        </div>
      )}
    </Layout>
  );
};
