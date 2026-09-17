import { clsx } from "clsx";
import { LockKeyhole, Search, Star } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";

import { Button } from "../components/Button";
import { ErrorCard } from "../components/ErrorCard";
import { GroupsSection } from "../components/GroupsSection";
import { HealthStrip } from "../components/HealthStrip";
import { JobSearch } from "../components/JobSearch";
import { JobTable } from "../components/JobTable";
import { Layout } from "../components/Layout";
import {
  canToggleQueueRunning,
  QueueActionMenu,
} from "../components/QueueActionMenu";
import { useQueuedash } from "../components/QueuedashProvider";
import { QueueStatusFilter } from "../components/QueueStatusFilter";
import { type QueueView, QueueViewTabs } from "../components/QueueViewTabs";
import { SchedulerTable } from "../components/SchedulerTable";
import { Skeleton } from "../components/Skeleton";
import { NUM_OF_RETRIES } from "../utils/config";
import { formatCount } from "../utils/format";
import {
  CARD_BORDER,
  FOCUS_RING,
  SECTION_LABEL,
  TEXT_MUTED,
} from "../utils/styles";
import type { Status } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import {
  getJobListRefetchInterval,
  type JobSort,
  shouldWriteEffectiveStatus,
  updateJobQueryParams,
  updateJobSortParams,
} from "../utils/viewState";

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

const isValidStatus = (value: string | null | undefined): value is Status =>
  !!value && VALID_STATUSES.includes(value as Status);

const ADAPTER_LABELS: Record<string, string> = {
  bull: "Bull",
  bullmq: "BullMQ",
  groupmq: "GroupMQ",
  bee: "Bee-Queue",
};

/** Memory pressure only becomes news near the ceiling; below that it is trivia. */
const memoryToneClass = (percentage: number): string => {
  if (percentage > 90) return "text-red-700 dark:text-red-400";
  if (percentage >= 75) return "text-amber-700 dark:text-amber-400";
  return TEXT_MUTED;
};

export const QueuePage = () => {
  const { portalContainer, preferences, setLastJobStatus, togglePinnedQueue } =
    useQueuedash();
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
  // Every other filter lives in the URL; a group kept in component state made
  // a filtered view unshareable and silently dropped it on reload while the
  // destructive buttons still said "Remove matches".
  const selectedGroupId = searchParams.get("group") || null;
  const selectedJobId = searchParams.get("job");
  const preferredStatus =
    preferences.defaultJobStatus === "remember"
      ? preferences.lastJobStatus
      : preferences.defaultJobStatus;
  const initialStatus = searchParams.get("status");
  const [status, setStatus] = useState<Status>(
    isValidStatus(initialStatus) ? initialStatus : preferredStatus,
  );

  const updateParams = useCallback(
    (
      mutate: (next: URLSearchParams) => void,
      options?: { replace?: boolean },
    ) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        mutate(next);
        return next;
      }, options);
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (rawQuery.length <= 200) return;
    updateParams((next) => next.set("q", query), { replace: true });
  }, [query, rawQuery.length, updateParams]);

  const handleStatusChange = useCallback(
    (next: Status) => {
      setLastJobStatus(next);
      updateParams((params) => {
        params.set("status", next);
        params.delete("view");
        params.delete("job");
      });
    },
    [setLastJobStatus, updateParams],
  );

  const handleViewChange = useCallback(
    (view: QueueView) => {
      updateParams((params) => {
        if (view === "schedulers") {
          params.set("view", "schedulers");
          params.delete("status");
        } else {
          params.delete("view");
        }
        params.delete("job");
      });
    },
    [updateParams],
  );

  const handleSelectGroup = useCallback(
    (groupId: string | null) => {
      updateParams((next) => {
        if (groupId) next.set("group", groupId);
        else next.delete("group");
        next.delete("job");
      });
    },
    [updateParams],
  );

  const handleClearFilters = useCallback(() => {
    updateParams((next) => {
      next.delete("q");
      next.delete("group");
    });
  }, [updateParams]);

  // Opening pushes so Back closes the panel instead of leaving the queue;
  // closing and stepping replace so triaging twenty failures doesn't bury the
  // queue twenty entries deep.
  const handleSelectJob = useCallback(
    (jobId: string | null) => {
      updateParams(
        (next) => {
          if (jobId) next.set("job", jobId);
          else next.delete("job");
        },
        { replace: jobId === null },
      );
    },
    [updateParams],
  );

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

  const jobListInput = {
    queueName,
    limit: preferences.jobsPerPage,
    status,
    groupId: selectedGroupId ?? undefined,
    query: query || undefined,
    sort,
  };

  const {
    data,
    fetchNextPage,
    isLoading,
    isError,
    isFetchingNextPage,
    isRefetching,
    hasNextPage,
    refetch,
  } = trpc.job.list.useInfiniteQuery(jobListInput, {
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
  });

  useEffect(() => {
    const searchStatus = searchParams.get("status");
    const requestedStatus = isValidStatus(searchStatus)
      ? searchStatus
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
      updateParams((next) => next.set("status", nextStatus), { replace: true });
    }
  }, [
    isSchedulersView,
    preferredStatus,
    queueReq.data?.supports.statuses,
    searchParams,
    status,
    updateParams,
  ]);

  useEffect(() => {
    if (
      !requestedSchedulersView ||
      !queueReq.data ||
      queueReq.data.supports.schedulers
    ) {
      return;
    }

    updateParams((next) => next.delete("view"), { replace: true });
  }, [queueReq.data, requestedSchedulersView, updateParams]);

  useEffect(() => {
    if (queueReq.data && !queueReq.data.supports.groups && selectedGroupId) {
      updateParams((next) => next.delete("group"), { replace: true });
    }
  }, [queueReq.data, selectedGroupId, updateParams]);

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
  const isJobListLoading = isLoading || queueReq.isPending;
  const loadedPageCount = data?.pages.length ?? 0;

  const utils = trpc.useUtils();
  const handleResetPages = () => {
    utils.job.list.setInfiniteData(jobListInput, (current) =>
      current && current.pages.length > 1
        ? {
            pages: current.pages.slice(0, 1),
            pageParams: current.pageParams.slice(0, 1),
          }
        : current,
    );
  };

  // The keyboard handler must read the live list without re-binding on every
  // poll, so it goes through a ref rather than the effect's dependencies.
  const jobsRef = useRef(jobs);
  useEffect(() => {
    jobsRef.current = jobs;
  });

  const stepSelectedJob = useCallback(
    (delta: number) => {
      const currentId = selectedJobId;
      if (!currentId) return;
      const currentJobs = jobsRef.current;
      const index = currentJobs.findIndex((job) => job.id === currentId);
      if (index < 0) return;
      const nextJob = currentJobs[index + delta];
      if (!nextJob) return;
      updateParams((next) => next.set("job", nextJob.id), { replace: true });
    },
    [selectedJobId, updateParams],
  );

  // Bound to the document but gated on the target, because the root itself is
  // never focused: on a fresh load `activeElement` is `<body>`, an *ancestor*
  // of the root, so a listener on the root alone never fired and the shortcuts
  // were dead until you clicked inside. Still embeddable - a keystroke aimed at
  // anything outside the dashboard is ignored.
  useEffect(() => {
    const root = portalContainer;
    if (!root) return;
    const doc = root.ownerDocument;

    const handleKeyDown = (event: Event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (
        keyboardEvent.defaultPrevented ||
        keyboardEvent.metaKey ||
        keyboardEvent.ctrlKey ||
        keyboardEvent.altKey
      ) {
        return;
      }

      const target = keyboardEvent.target as HTMLElement | null;
      // `body`/`html` mean "nothing in particular is focused" and belong to us;
      // any other node outside the root belongs to the host app.
      const isOurs =
        !target ||
        target === doc.body ||
        target === doc.documentElement ||
        root.contains(target);
      if (!isOurs) return;

      const isTyping = !!target?.closest?.(
        "input, textarea, select, [contenteditable='true']",
      );

      if (keyboardEvent.key === "Escape") {
        if (selectedJobId) handleSelectJob(null);
        return;
      }

      if (isTyping) return;

      // The open panel is a focus-trapped dialog, so pulling focus back to the
      // filter behind it would only be undone by the trap.
      if (keyboardEvent.key === "/" && !selectedJobId) {
        const input = root.querySelector<HTMLInputElement>(
          'input[aria-label="Filter jobs"]',
        );
        if (!input) return;
        keyboardEvent.preventDefault();
        input.focus();
        input.select();
        return;
      }

      if (!selectedJobId) return;

      if (keyboardEvent.key === "j") {
        keyboardEvent.preventDefault();
        stepSelectedJob(1);
        return;
      }

      if (keyboardEvent.key === "k") {
        keyboardEvent.preventDefault();
        stepSelectedJob(-1);
      }
    };

    doc.addEventListener("keydown", handleKeyDown);
    return () => doc.removeEventListener("keydown", handleKeyDown);
  }, [handleSelectJob, portalContainer, selectedJobId, stepSelectedJob]);

  // "Here's a job ID from a ticket, where is it?" - without this the only
  // answer is to guess the status and press Apply in all eight tabs.
  const [searchAllStatuses, setSearchAllStatuses] = useState(false);
  useEffect(() => {
    setSearchAllStatuses(false);
  }, [query, queueName, status]);

  const crossStatusSearch = trpc.job.search.useQuery(
    { queueName, query },
    {
      enabled: searchAllStatuses && !!query && !isSchedulersView,
      retry: NUM_OF_RETRIES,
    },
  );

  // Offered whenever a filter is active, not only when this status came up
  // empty: one incidental match in `completed` used to hide the only route to
  // the same job sitting in `failed`.
  const showCrossStatusSearch =
    !isSchedulersView && !isError && !isJobListLoading && !!query;
  const hasMatchesInStatus = jobs.length > 0;

  const openJobInStatus = (jobId: string, jobStatus: Status) => {
    updateParams((next) => {
      next.set("status", jobStatus);
      next.delete("view");
      next.delete("group");
      next.set("job", jobId);
    });
  };

  const isPinned = preferences.pinnedQueues.includes(queueName);
  const client = queueReq.data?.client;
  const blockedClients = client?.blockedClients ?? 0;
  const memoryPercentage = (client?.usedMemoryPercentage ?? 0) * 100;
  // What the queue runs on, as a subtitle: identity first (adapter, Redis
  // version), then the two numbers that can go wrong. This used to be a bar
  // pinned to the bottom of the viewport, which handed Redis memory trivia
  // the most permanent slot on the page.
  const connectionMeta =
    queueReq.data && client ? (
      <p
        className={clsx(
          "mt-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[11px] tabular-nums",
          TEXT_MUTED,
        )}
      >
        <span>{ADAPTER_LABELS[queueReq.data.type] ?? queueReq.data.type}</span>
        <span aria-hidden="true">·</span>
        <span>Redis {client.version}</span>
        <span aria-hidden="true">·</span>
        <span>{formatCount(client.connectedClients)} clients</span>
        {/* Red is the colour that means "wrong". No blocked clients is the
            healthy state, so it is not mentioned at all. */}
        {blockedClients > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-red-700 dark:text-red-400">
              {formatCount(blockedClients)} blocked
            </span>
          </>
        ) : null}
        <span aria-hidden="true">·</span>
        <span className={memoryToneClass(memoryPercentage)}>
          {client.usedMemoryHuman} of {client.totalMemoryHuman} memory
        </span>
      </p>
    ) : queueReq.data ? null : (
      <Skeleton className="mt-1.5 h-3.5 w-72 rounded" />
    );

  return (
    <Layout>
      {queueReq.isError ? (
        queueReq.error.data?.code === "NOT_FOUND" ? (
          <ErrorCard
            tone="empty"
            title="No queue found"
            message={`No queue named "${queueName}" is registered with this dashboard. Check the link, or pick a queue from the sidebar.`}
          />
        ) : (
          <ErrorCard
            title="Could not fetch queue"
            message={
              queueReq.error.message ||
              "The dashboard could not reach this queue's Redis connection."
            }
            onRetry={() => queueReq.refetch()}
            isRetrying={queueReq.isRefetching}
          />
        )
      ) : (
        <div className="space-y-5">
          <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
                  {queueReq.data ? (
                    queueReq.data.displayName
                  ) : (
                    <Skeleton className="h-7 w-40 rounded" />
                  )}
                </h1>
                {queueReq.data ? (
                  <button
                    type="button"
                    onClick={() => togglePinnedQueue(queueName)}
                    aria-label={`${isPinned ? "Unpin" : "Pin"} ${queueReq.data.displayName}`}
                    title={`${isPinned ? "Unpin" : "Pin"} queue`}
                    className={clsx(
                      "flex size-7 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-amber-500 active:bg-gray-200 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-amber-400 dark:active:bg-slate-700",
                      FOCUS_RING,
                    )}
                  >
                    <Star
                      className="size-3.5"
                      fill={isPinned ? "currentColor" : "none"}
                    />
                  </button>
                ) : null}
                {queueReq.data?.access.mode === "read-only" ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-gray-100 px-2 py-px text-[10px] font-medium text-gray-600 dark:bg-slate-800 dark:text-slate-300">
                    <LockKeyhole className="size-2.5" />
                    Read-only
                  </span>
                ) : null}
                {/* Redundant beside the amber Resume button, so it is only
                    shown on mobile, where Resume folds into the menu, and to
                    viewers who cannot resume. */}
                {queueReq.data?.paused ? (
                  <span
                    className={clsx(
                      "shrink-0 rounded-full bg-amber-100 px-2 py-px text-[10px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
                      canToggleQueueRunning(queueReq.data) && "sm:hidden",
                    )}
                  >
                    Paused
                  </span>
                ) : null}
              </div>
              {connectionMeta}
            </div>
            {/* Actions sit at the far edge, where every other page puts them,
                instead of in the run of badges after the title. */}
            {queueReq.data ? <QueueActionMenu queue={queueReq.data} /> : null}
          </header>

          <HealthStrip
            key={queueName}
            queue={queueReq.data}
            queueName={queueName}
          />

          <div className="space-y-3">
            {queueReq.data?.supports.schedulers ? (
              <QueueViewTabs
                view={isSchedulersView ? "schedulers" : "jobs"}
                schedulerCount={schedulersReq.data?.length}
                onViewChange={handleViewChange}
              />
            ) : null}
            {!isSchedulersView ? (
              <QueueStatusFilter
                status={status}
                queue={queueReq.data}
                onStatusChange={handleStatusChange}
              />
            ) : null}
            {!isSchedulersView && queueReq.data?.supports.groups ? (
              <GroupsSection
                canRemoveJobs={queueReq.data.access.actions["job.remove"]}
                queueName={queueName}
                selectedGroupId={selectedGroupId}
                onSelectGroup={handleSelectGroup}
              />
            ) : null}
            {!isSchedulersView ? (
              <JobSearch
                query={query}
                sort={sort}
                isLoading={isJobListLoading}
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
              <ErrorCard
                title="Could not fetch jobs"
                message={`The ${status} list could not be read. The queue itself is still reachable.`}
                onRetry={() => refetch()}
                isRetrying={isRefetching}
              />
            ) : (
              <div className="space-y-3">
                <JobTable
                  onBottomInView={() => {
                    if (isFetchingNextPage || !hasNextPage) return;
                    fetchNextPage();
                  }}
                  status={status}
                  totalJobs={totalJobs}
                  jobs={jobs.map((j) => ({ ...j, status }))}
                  isLoading={isJobListLoading}
                  isFetchingNextPage={isFetchingNextPage}
                  queueName={queueName}
                  queue={queueReq.data}
                  selectedGroupId={selectedGroupId}
                  selectedJobId={selectedJobId}
                  onSelectJob={handleSelectJob}
                  onClearFilters={handleClearFilters}
                  loadedPageCount={loadedPageCount}
                  onResetPages={handleResetPages}
                  query={query || undefined}
                  scannedCount={searchMeta?.scanned}
                  searchIsPartial={searchMeta?.capped === true}
                />
                {showCrossStatusSearch ? (
                  <div className={clsx("rounded-xl p-4", CARD_BORDER)}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className={SECTION_LABEL}>
                        {hasMatchesInStatus
                          ? "Other statuses"
                          : `Not in ${status}`}
                      </p>
                      {searchAllStatuses ? null : (
                        <Button
                          size="sm"
                          label="Search all statuses"
                          icon={<Search className="size-3.5" />}
                          onClick={() => setSearchAllStatuses(true)}
                        />
                      )}
                    </div>
                    {searchAllStatuses ? (
                      crossStatusSearch.isPending ? (
                        <div className="mt-3 space-y-2">
                          <Skeleton className="h-8 w-full rounded-lg" />
                          <Skeleton className="h-8 w-full rounded-lg" />
                        </div>
                      ) : crossStatusSearch.isError ? (
                        <ErrorCard
                          className="mt-3"
                          title="Could not search all statuses"
                          message={crossStatusSearch.error.message}
                          onRetry={() => crossStatusSearch.refetch()}
                          isRetrying={crossStatusSearch.isRefetching}
                        />
                      ) : crossStatusSearch.data.results.length === 0 ? (
                        <p className={clsx("mt-2 text-sm", TEXT_MUTED)}>
                          No job matching “{query}” in any status.
                        </p>
                      ) : (
                        <ul className="mt-3 space-y-1">
                          {crossStatusSearch.data.results.map(
                            ({ job, status: jobStatus }) => (
                              <li key={`${jobStatus ?? "unknown"}-${job.id}`}>
                                <button
                                  type="button"
                                  disabled={!isValidStatus(jobStatus)}
                                  onClick={() => {
                                    if (!isValidStatus(jobStatus)) return;
                                    openJobInStatus(job.id, jobStatus);
                                  }}
                                  className={clsx(
                                    "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-150 enabled:hover:bg-gray-50 enabled:active:bg-gray-100 disabled:opacity-60 dark:enabled:hover:bg-slate-800/60 dark:enabled:active:bg-slate-800",
                                    FOCUS_RING,
                                  )}
                                >
                                  <span className="truncate font-mono text-sm text-gray-900 dark:text-white">
                                    {job.name?.trim() || job.id}
                                  </span>
                                  <span
                                    className={clsx(
                                      "shrink-0 rounded-full bg-gray-100 px-2 py-px text-[10px] font-medium dark:bg-slate-800",
                                      TEXT_MUTED,
                                    )}
                                  >
                                    {jobStatus ?? "unknown"}
                                  </span>
                                </button>
                              </li>
                            ),
                          )}
                        </ul>
                      )
                    ) : (
                      <p className={clsx("mt-2 text-sm", TEXT_MUTED)}>
                        {hasMatchesInStatus
                          ? `This list only covers ${status}. Other jobs matching “${query}” may be sitting in another status.`
                          : `Nothing in ${status} matches “${query}”. It may be sitting in another status.`}
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
};
