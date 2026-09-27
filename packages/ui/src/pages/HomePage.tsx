import { clsx } from "clsx";
import { CirclePause, CirclePlay } from "lucide-react";
import { useState } from "react";

import { ActionMenu } from "../components/ActionMenu";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { ErrorCard } from "../components/ErrorCard";
import { Layout } from "../components/Layout";
import {
  OVERVIEW_STAT_LABELS,
  OVERVIEW_STATS_GRID,
  OverviewQueueCard,
} from "../components/OverviewQueueCard";
import { useQueuedash } from "../components/QueuedashProvider";
import { Skeleton } from "../components/Skeleton";
import { StatCell, StatCellSkeleton, StatStrip } from "../components/StatStrip";
import { NUM_OF_RETRIES } from "../utils/config";
import { formatCount, formatCountLabel } from "../utils/format";
import { mutationToasts } from "../utils/mutationToasts";
import { SECTION_LABEL, TEXT_MUTED } from "../utils/styles";
import { trpc } from "../utils/trpc";

/** The overview is one list, not a stack of chips: the rows sit directly on the
 *  page's own card, separated by the standard hairline. */
const LIST_DIVIDER = "divide-y divide-gray-100/60 dark:divide-slate-800/60";

type QueueSummary = {
  name: string;
  displayName: string;
  access: { mode: "full" | "read-only" | "hidden" };
};

/** Decorative: every row already carries the same labels for a screen reader. */
const ColumnLabels = () => (
  <div
    aria-hidden="true"
    className="-mx-3 hidden items-center gap-4 px-3 pb-1.5 sm:flex"
  >
    <div className="min-w-0 flex-1" />
    <div className={OVERVIEW_STATS_GRID}>
      {OVERVIEW_STAT_LABELS.map((label) => (
        <span
          key={label}
          // Sentence case, not SECTION_LABEL: uppercase + tracking makes
          // "Completed" ~25% wider than the numeric column beneath it
          // needs to be, and this matches the job table's own headers.
          className={clsx(
            "truncate text-right text-xs font-medium",
            TEXT_MUTED,
          )}
        >
          {label}
        </span>
      ))}
    </div>
  </div>
);

export const HomePage = () => {
  const { preferences } = useQueuedash();
  const { data, error, isError, isLoading, isRefetching, refetch } =
    trpc.queue.list.useQuery(undefined, {
      refetchInterval: preferences.refreshIntervalMs,
    });
  const [confirm, setConfirm] = useState<"pauseAll" | null>(null);
  const { mutate: pauseAll, isPending: isPausingAll } =
    trpc.queue.pauseAll.useMutation(mutationToasts("All queues paused"));
  const { mutate: resumeAll } = trpc.queue.resumeAll.useMutation(
    mutationToasts("All queues resumed"),
  );

  const isPinned = (queue: QueueSummary) =>
    preferences.pinnedQueues.includes(queue.name);
  const sortedQueues = data
    ? [...data].sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      )
    : [];
  // The same two groups as the sidebar, so a pinned queue is in the same
  // place on every screen.
  const pinnedQueues = sortedQueues.filter(isPinned);
  const otherQueues = sortedQueues.filter((queue) => !isPinned(queue));
  const orderedQueues = [...pinnedQueues, ...otherQueues];

  // Every queue's counts in one batched request per poll. The rows used to
  // fetch their own as they scrolled into view, which kept the page from ever
  // adding them up.
  const details = trpc.useQueries((t) =>
    orderedQueues.map((queue) =>
      t.queue.byName(
        { queueName: queue.name },
        {
          refetchInterval: preferences.refreshIntervalMs,
          retry: NUM_OF_RETRIES,
        },
      ),
    ),
  );
  const detailByName = new Map(
    orderedQueues.map((queue, index) => [queue.name, details[index]]),
  );

  const fleet = details.reduce(
    (acc, detail) => {
      const queue = detail.data;
      if (!queue) {
        if (detail.isError) acc.unavailable += 1;
        else acc.pending += 1;
        return acc;
      }
      if (queue.paused) acc.paused += 1;
      acc.active += queue.counts.active;
      if (queue.counts.active > 0) acc.busyQueues += 1;
      acc.waiting += queue.counts.waiting;
      acc.delayed += queue.counts.delayed;
      acc.failed += queue.counts.failed;
      if (queue.counts.failed > 0) acc.failingQueues += 1;
      return acc;
    },
    {
      pending: 0,
      unavailable: 0,
      paused: 0,
      active: 0,
      busyQueues: 0,
      waiting: 0,
      delayed: 0,
      failed: 0,
      failingQueues: 0,
    },
  );
  const readOnlyCount = sortedQueues.filter(
    (queue) => queue.access.mode === "read-only",
  ).length;
  const queuesSub =
    [
      fleet.paused > 0 && `${fleet.paused} paused`,
      readOnlyCount > 0 && `${readOnlyCount} read-only`,
      fleet.unavailable > 0 && `${fleet.unavailable} unavailable`,
    ]
      .filter(Boolean)
      .join(" · ") || "all running";

  const pausableCount =
    data?.filter(
      (queue) => queue.supports.pause && queue.access.actions["queue.pause"],
    ).length ?? 0;
  const actions = [
    ...(data?.some(
      (queue) => queue.supports.resume && queue.access.actions["queue.resume"],
    )
      ? [
          {
            label: "Resume all",
            icon: <CirclePlay className="size-3.5" />,
            onSelect: () => resumeAll(),
          },
        ]
      : []),
    ...(pausableCount > 0
      ? [
          {
            label: "Pause all",
            icon: <CirclePause className="size-3.5" />,
            // A MenuItem closes the menu as it fires, so the confirmation lives
            // outside the menu and is armed from here.
            onSelect: () => setConfirm("pauseAll"),
            tone: "warning" as const,
          },
        ]
      : []),
  ];

  const renderRows = (queues: QueueSummary[]) => (
    <div className={LIST_DIVIDER}>
      {queues.map((queue) => {
        const detail = detailByName.get(queue.name);
        return (
          <OverviewQueueCard
            key={queue.name}
            queueName={queue.name}
            queue={detail?.data}
            isLoading={detail?.isPending ?? true}
            isError={detail?.isError ?? false}
            onRetry={() => detail?.refetch()}
            isRetrying={detail?.isRefetching ?? false}
          />
        );
      })}
    </div>
  );

  return (
    <Layout>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
            Overview
          </h1>
          {/* Always rendered: dropping the line while loading pushed the list
              below it up by ~20px, then back down when the count arrived. */}
          <p className={clsx("mt-0.5 text-sm", TEXT_MUTED)}>
            {data
              ? `${formatCountLabel(data.length, "queue")} on this dashboard`
              : " "}
          </p>
        </div>
        {actions.length > 0 ? <ActionMenu actions={actions} /> : null}
      </div>

      {/* The same strip the queue page opens with, summed across the fleet:
          the one question the overview exists to answer is "is anything
          wrong?", and four column totals answer it before the list is read. */}
      {isLoading || (data && data.length > 0) ? (
        <div className="mt-4">
          <StatStrip label="Health" ariaLabel="Fleet health" columns={4}>
            {isLoading || fleet.pending > 0 ? (
              [...Array(4)].map((_, i) => <StatCellSkeleton key={i} />)
            ) : (
              <>
                <StatCell
                  label="Queues"
                  value={formatCount(data?.length ?? 0)}
                  sub={queuesSub}
                  tone={fleet.unavailable > 0 ? "warning" : "neutral"}
                />
                <StatCell
                  label="Active"
                  value={formatCount(fleet.active)}
                  sub={
                    fleet.busyQueues > 0
                      ? `in ${formatCountLabel(fleet.busyQueues, "queue")}`
                      : "nothing processing"
                  }
                />
                <StatCell
                  label="Waiting"
                  value={formatCount(fleet.waiting)}
                  sub={`${formatCount(fleet.delayed)} delayed`}
                />
                <StatCell
                  label="Failed"
                  value={formatCount(fleet.failed)}
                  tone={fleet.failed > 0 ? "negative" : "neutral"}
                  sub={
                    fleet.failingQueues > 0
                      ? `in ${formatCountLabel(fleet.failingQueues, "queue")}`
                      : "none"
                  }
                />
              </>
            )}
          </StatStrip>
        </div>
      ) : null}

      <section className="mt-5">
        <h2 className="sr-only">Queues</h2>

        {isLoading ? (
          // Same wrapper as the loaded list, so the rows do not shift when
          // the data lands.
          <>
            <ColumnLabels />
            <div className={LIST_DIVIDER}>
              {[...Array(6)].map((_, i) => (
                <div key={i} className="-mx-3 px-3 py-2.5">
                  <Skeleton className="h-5 rounded" />
                </div>
              ))}
            </div>
          </>
        ) : isError ? (
          <ErrorCard
            title="Could not fetch queues"
            message={
              error?.message ||
              "The dashboard could not reach Redis. Check the connection and try again."
            }
            onRetry={() => refetch()}
            isRetrying={isRefetching}
          />
        ) : sortedQueues.length ? (
          pinnedQueues.length ? (
            <>
              <div className={clsx("mb-2", SECTION_LABEL)}>Pinned</div>
              <ColumnLabels />
              {renderRows(pinnedQueues)}
              {otherQueues.length ? (
                <>
                  <div className={clsx("mt-6 mb-2", SECTION_LABEL)}>
                    All queues
                  </div>
                  {renderRows(otherQueues)}
                </>
              ) : null}
            </>
          ) : (
            <>
              <ColumnLabels />
              {renderRows(otherQueues)}
            </>
          )
        ) : (
          <ErrorCard
            tone="empty"
            title="No queues yet"
            message="This dashboard is connected, but no queues are registered with it. Add a queue to the Queuedash API setup and it will appear here."
            onRetry={() => refetch()}
            isRetrying={isRefetching}
          />
        )}
      </section>

      <Alert
        isOpen={confirm === "pauseAll"}
        onOpenChange={(isOpen) => {
          if (!isOpen) setConfirm(null);
        }}
        isPending={isPausingAll}
        title="Pause all queues?"
        description={`Workers stop picking up new jobs across ${formatCountLabel(
          pausableCount,
          "queue",
        )} until you resume them. Jobs already running are left to finish.`}
        action={
          <Button
            variant="filled"
            colorScheme="yellow"
            label="Pause all"
            onClick={() =>
              pauseAll(undefined, { onSettled: () => setConfirm(null) })
            }
          />
        }
      />
    </Layout>
  );
};
