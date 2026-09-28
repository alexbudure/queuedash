import { keepPreviousData } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AlertTriangle, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Button } from "../components/Button";
import { ErrorCard } from "../components/ErrorCard";
import { FlowStatusPill, FlowWaterfall } from "../components/FlowWaterfall";
import { JobModal } from "../components/JobModal";
import { Layout } from "../components/Layout";
import { useQueuedash } from "../components/QueuedashProvider";
import { Skeleton } from "../components/Skeleton";
import { NUM_OF_RETRIES } from "../utils/config";
import {
  type FlowJob,
  flattenFlow,
  formatJobId,
  getFlowNodeKey,
  getFlowWindow,
  getWaitingOn,
  summarizeFlow,
  toListStatus,
  walkFlow,
} from "../utils/flow";
import { formatCount, formatDuration, pluralize } from "../utils/format";
import { BULK_VERBS, bulkResultToast } from "../utils/mutationToasts";
import { FOCUS_RING, TEXT_MUTED } from "../utils/styles";
import type { Job } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { isShortcutExemptTarget } from "../utils/viewState";

// A flow is read with a request per job, so it refreshes on a slower floor
// than a queue's own list.
const FLOW_MIN_REFRESH_MS = 5_000;
// How many more children "Show more" asks for at a time.
const SHOW_MORE_STEP = 200;
const DEFAULT_CHILD_LIMIT = 50;

// The job panel opens from a list row, and a flow has no list, so it starts
// from the flow's own record of the job; its live lookup replaces this within
// the first request.
const toJobSnapshot = (job: FlowJob): Job => ({
  id: job.id,
  name: job.name,
  data: {},
  opts: {},
  createdAt: new Date(job.createdAt ?? 0).toISOString(),
  processedAt:
    job.processedAt === null ? null : new Date(job.processedAt).toISOString(),
  finishedAt:
    job.finishedAt === null ? null : new Date(job.finishedAt).toISOString(),
  failedReason: job.failedReason ?? undefined,
  retriedAt: null,
  attemptsMade: job.attemptsMade,
});

const LEGEND = [
  { label: "Waiting", className: "bg-gray-300 dark:bg-slate-600" },
  { label: "Waiting for children", className: "qd-flow-children" },
  { label: "Active", className: "bg-blue-500" },
  { label: "Ran", className: "bg-green-500" },
  { label: "Failed attempt", className: "bg-red-500" },
];

const describeWaitingOn = (root: FlowJob, now: number) => {
  const waitingOn = getWaitingOn(root);
  if (!waitingOn || waitingOn.blocking.length === 0) return null;

  // What holds the flow can sit further down: a child waiting on its own
  // failed child is stuck for the same reason, so the failure is named.
  const failures = walkFlow(root).filter(
    (job) => job.status === "failed" && job.blocksParent,
  );
  const parts: string[] = [];
  const [running] = waitingOn.running;
  if (running?.processedAt) {
    parts.push(
      `${running.name} has been running for ${formatDuration(now - running.processedAt)}.`,
    );
  }
  const [failed] = failures;
  if (failed) {
    const more =
      failures.length > 1 ? `, and ${failures.length - 1} more failed` : "";
    parts.push(
      `${failed.name} failed${
        failed.attemptsMade > 1 ? ` after ${failed.attemptsMade} attempts` : ""
      }${more}. The flow can't finish until ${
        failures.length === 1 ? "that job is" : "those jobs are"
      } retried or removed.`,
    );
  }
  if (parts.length === 0) {
    const waiting = waitingOn.blocking.slice(0, 2).map(({ name }) => name);
    const rest = waitingOn.blocking.length - waiting.length;
    parts.push(
      `${waiting.join(" and ")}${rest > 0 ? ` and ${rest} more` : ""} ${
        waitingOn.blocking.length === 1 ? "hasn't" : "haven't"
      } run yet.`,
    );
  }

  return {
    headline: `Waiting on ${formatCount(waitingOn.blocking.length)} of ${formatCount(
      waitingOn.total,
    )} ${pluralize(waitingOn.total, "child", "children")}.`,
    detail: parts.join(" "),
  };
};

const findFlowJob = (
  root: FlowJob | undefined,
  queueName: string | null,
  jobId: string | null,
): FlowJob | null => {
  if (!root || !queueName || !jobId) return null;
  return (
    walkFlow(root).find(
      (job) => job.queueName === queueName && job.id === jobId,
    ) ?? null
  );
};

export const FlowPage = () => {
  const { portalContainer, preferences } = useQueuedash();
  const { id: queueName = "", jobId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const openQueueName = searchParams.get("jobQueue");
  const openJobId = searchParams.get("job");

  const [childLimits, setChildLimits] = useState<Record<string, number>>({});
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const treeReq = trpc.flow.tree.useQuery(
    {
      queueName,
      jobId,
      childLimits: Object.keys(childLimits).length ? childLimits : undefined,
    },
    {
      enabled: Boolean(queueName && jobId),
      refetchInterval:
        preferences.refreshIntervalMs === false
          ? false
          : Math.max(preferences.refreshIntervalMs, FLOW_MIN_REFRESH_MS),
      retry: NUM_OF_RETRIES,
      // "Show more" asks for a new tree; the old one stays up meanwhile.
      placeholderData: keepPreviousData,
    },
  );
  const queuesReq = trpc.queue.list.useQuery(undefined, {
    staleTime: 30_000,
  });
  const queueLabels = useMemo(
    () =>
      new Map(
        (queuesReq.data ?? []).map((queue) => [queue.name, queue.displayName]),
      ),
    [queuesReq.data],
  );
  const retryAllowed = useCallback(
    (name: string) =>
      queuesReq.data?.find((queue) => queue.name === name)?.access.actions[
        "job.retry"
      ] === true,
    [queuesReq.data],
  );

  const tree = treeReq.data;
  const root = tree?.root;
  const now = tree?.now ?? Date.now();
  const rows = useMemo(
    () => (root ? flattenFlow(root, collapsed) : []),
    [collapsed, root],
  );
  const jobRows = useMemo(
    () =>
      rows.flatMap((row) =>
        row.kind === "job" && row.job.status !== "removed" ? [row.job] : [],
      ),
    [rows],
  );
  const selectedJob = findFlowJob(root, openQueueName, openJobId);
  const selectedKey = selectedJob ? getFlowNodeKey(selectedJob) : null;
  const focusKey = `${queueName}:${jobId}`;

  const selectJob = useCallback(
    (job: FlowJob | null, options?: { replace?: boolean }) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (job) {
            next.set("jobQueue", job.queueName);
            next.set("job", job.id);
          } else {
            next.delete("jobQueue");
            next.delete("job");
          }
          return next;
        },
        { replace: options?.replace ?? job === null },
      );
    },
    [setSearchParams],
  );

  const jobRowsRef = useRef(jobRows);
  useEffect(() => {
    jobRowsRef.current = jobRows;
  });
  const stepSelection = useCallback(
    (delta: 1 | -1) => {
      const current = jobRowsRef.current;
      const index = current.findIndex(
        (job) => job.queueName === openQueueName && job.id === openJobId,
      );
      const next = current[index + delta];
      if (index >= 0 && next) selectJob(next, { replace: true });
    },
    [openJobId, openQueueName, selectJob],
  );

  // The queue page's keyboard model: j/k step while the panel is open,
  // Escape closes it, and keys aimed outside the dashboard are left alone.
  useEffect(() => {
    const rootElement = portalContainer;
    if (!rootElement) return;
    const doc = rootElement.ownerDocument;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const isOurs =
        !target ||
        target === doc.body ||
        target === doc.documentElement ||
        rootElement.contains(target);
      if (!isOurs || isShortcutExemptTarget(target)) return;
      if (!openJobId) return;
      if (event.key === "Escape") selectJob(null);
      else if (event.key === "j") {
        event.preventDefault();
        stepSelection(1);
      } else if (event.key === "k") {
        event.preventDefault();
        stepSelection(-1);
      }
    };
    doc.addEventListener("keydown", handleKeyDown);
    return () => doc.removeEventListener("keydown", handleKeyDown);
  }, [openJobId, portalContainer, selectJob, stepSelection]);

  const retryMutation = trpc.job.bulkRetry.useMutation();
  const [isRetrying, setIsRetrying] = useState(false);
  const retryable = root
    ? walkFlow(root).filter(
        (job) => job.status === "failed" && retryAllowed(job.queueName),
      )
    : [];
  const retryFailed = async () => {
    const byQueue = new Map<string, string[]>();
    for (const job of retryable) {
      byQueue.set(job.queueName, [
        ...(byQueue.get(job.queueName) ?? []),
        job.id,
      ]);
    }
    setIsRetrying(true);
    let succeeded = 0;
    let failed = 0;
    for (const [name, jobIds] of Array.from(byQueue)) {
      try {
        const result = await retryMutation.mutateAsync({
          queueName: name,
          jobIds,
        });
        succeeded += result.succeeded;
        failed += result.failed;
      } catch {
        failed += jobIds.length;
      }
    }
    setIsRetrying(false);
    bulkResultToast(BULK_VERBS.retry, "job", { succeeded, failed });
    void treeReq.refetch();
  };

  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const showMore = (parent: FlowJob) =>
    setChildLimits((current) => {
      const key = getFlowNodeKey(parent);
      const loaded = current[key] ?? DEFAULT_CHILD_LIMIT;
      return {
        ...current,
        [key]: Math.min(loaded + SHOW_MORE_STEP, tree?.maxChildLimit ?? 1_000),
      };
    });

  if (treeReq.isError) {
    return (
      <Layout>
        {treeReq.error.data?.code === "NOT_FOUND" ? (
          <ErrorCard
            tone="empty"
            title="No such job"
            message={`There is no job ${jobId} in this queue. It may have been removed, or the link may be out of date.`}
          />
        ) : (
          <ErrorCard
            title="Could not load this flow"
            message={treeReq.error.message}
            onRetry={() => treeReq.refetch()}
            isRetrying={treeReq.isRefetching}
          />
        )}
      </Layout>
    );
  }

  if (!root || !tree) {
    return (
      <Layout>
        <div className="space-y-4">
          <Skeleton className="h-4 w-48 rounded" />
          <Skeleton className="h-7 w-72 rounded" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </Layout>
    );
  }

  const clock = getFlowWindow(root, now);
  const summary = summarizeFlow(root);
  const waitingOn = describeWaitingOn(root, now);
  const rootQueueLabel = queueLabels.get(root.queueName) ?? root.queueName;
  const countParts = [
    summary.counts.completed && `${summary.counts.completed} completed`,
    summary.counts.running && `${summary.counts.running} active`,
    summary.counts.failed && `${summary.counts.failed} failed`,
    summary.counts.waiting && `${summary.counts.waiting} waiting`,
  ].filter(Boolean);

  return (
    <Layout>
      {selectedJob && openQueueName ? (
        <JobModal
          key={selectedKey}
          queueName={openQueueName}
          job={toJobSnapshot(selectedJob)}
          status={toListStatus(selectedJob.status)}
          onDismiss={() => selectJob(null)}
          onJobLeft={(leftId) => {
            if (leftId === openJobId) selectJob(null);
          }}
          onStep={stepSelection}
          canStepPrevious={
            jobRows.findIndex((job) => getFlowNodeKey(job) === selectedKey) > 0
          }
          canStepNext={(() => {
            const index = jobRows.findIndex(
              (job) => getFlowNodeKey(job) === selectedKey,
            );
            return index >= 0 && index < jobRows.length - 1;
          })()}
        />
      ) : null}

      <div className="space-y-5">
        <header>
          <nav
            aria-label="Breadcrumb"
            className={clsx(
              "flex flex-wrap items-center gap-1.5 text-xs",
              TEXT_MUTED,
            )}
          >
            <Link
              to={`/queues/${encodeURIComponent(root.queueName)}`}
              className={clsx(
                "rounded hover:text-gray-900 dark:hover:text-white",
                FOCUS_RING,
              )}
            >
              {rootQueueLabel}
            </Link>
            <span aria-hidden="true">/</span>
            <span className="font-mono" title={root.id}>
              #{formatJobId(root.id)}
            </span>
            <span aria-hidden="true">/</span>
            <span>Flow</span>
          </nav>
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
            <h1 className="font-mono text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
              {root.name}
            </h1>
            <span
              title={root.id}
              className={clsx(
                "rounded-md bg-gray-100 px-1.5 font-mono text-[11px] leading-[18px] dark:bg-slate-800",
                TEXT_MUTED,
              )}
            >
              #{formatJobId(root.id)}
            </span>
            <FlowStatusPill job={root} />
            <span className="flex-1" />
            {retryable.length > 0 ? (
              <Button
                colorScheme="red"
                icon={<RotateCw className="size-3.5" />}
                label={`Retry ${formatCount(retryable.length)} failed`}
                isLoading={isRetrying}
                onClick={retryFailed}
              />
            ) : null}
          </div>
          <p
            className={clsx(
              "mt-1 font-mono text-[11px] tabular-nums",
              TEXT_MUTED,
            )}
          >
            {formatCount(summary.jobCount)} {pluralize(summary.jobCount, "job")}{" "}
            in {formatCount(summary.queueCount)}{" "}
            {pluralize(summary.queueCount, "queue")}
            {summary.hidden > 0
              ? `, and ${formatCount(summary.hidden)} you can't see`
              : ""}
            {" · "}
            {clock.isOpen
              ? `started ${formatDuration(now - clock.start)} ago`
              : `took ${formatDuration(clock.end - clock.start)}`}
            {countParts.length ? ` · ${countParts.join(", ")}` : ""}
          </p>
          {tree.parentHidden ? (
            <p className={clsx("mt-1 text-xs", TEXT_MUTED)}>
              This flow continues above, in a queue you can't see.
            </p>
          ) : null}
        </header>

        {waitingOn ? (
          <div
            role="note"
            className="flex items-start gap-2.5 rounded-xl border border-orange-200 bg-orange-50 px-3.5 py-2.5 text-sm text-gray-700 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-slate-300"
          >
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-orange-600 dark:text-orange-400"
            />
            <p>
              <strong className="font-semibold text-gray-900 dark:text-white">
                {waitingOn.headline}
              </strong>{" "}
              {waitingOn.detail}
            </p>
          </div>
        ) : null}

        <div className="space-y-2.5">
          <div
            aria-label="Legend"
            className={clsx(
              "flex flex-wrap gap-x-4 gap-y-1.5 text-xs",
              TEXT_MUTED,
            )}
          >
            {LEGEND.map((item) => (
              <span
                key={item.label}
                className="inline-flex items-center gap-1.5"
              >
                <i
                  aria-hidden="true"
                  className={clsx(
                    "inline-block h-2 w-3.5 rounded-sm",
                    item.className,
                  )}
                />
                {item.label}
              </span>
            ))}
          </div>
          <FlowWaterfall
            rows={rows}
            clock={clock}
            now={now}
            selectedKey={selectedKey}
            focusKey={focusKey}
            queueLabels={queueLabels}
            onSelect={(job) => selectJob(job)}
            onToggle={toggle}
            onShowMore={showMore}
          />
          {tree.truncated ? (
            <p className={clsx("text-xs", TEXT_MUTED)}>
              This flow is larger than one view loads, so some children aren't
              shown. Collapse what you've read and use Show more on the rest.
            </p>
          ) : null}
        </div>
      </div>
    </Layout>
  );
};
