import { clsx } from "clsx";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import {
  byAttention,
  type FlowJob,
  formatJobId,
  getFlowPath,
  getFlowTook,
  getJobPath,
  toListStatus,
} from "../utils/flow";
import { formatCount, formatDuration } from "../utils/format";
import { STATUS_ICONS, STATUS_LABELS } from "../utils/status";
import { FOCUS_RING, TEXT_MUTED } from "../utils/styles";
import type { Queue } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { DetailSection } from "./DetailView";
import { FlowStatusPill } from "./FlowWaterfall";
import { useQueuedash } from "./QueuedashProvider";

const VISIBLE_CHILDREN = 3;

// One colour per kind of child in the bar, the way the job table colours
// status: done, running, failed, still to run, and what the viewer can't see.
const BAR_KINDS = [
  { key: "completed", className: "bg-green-500", label: "completed" },
  { key: "active", className: "bg-blue-500", label: "active" },
  { key: "failed", className: "bg-red-500", label: "failed" },
  {
    key: "waiting",
    className: "bg-gray-300 dark:bg-slate-600",
    label: "waiting",
  },
  {
    key: "hidden",
    className: "bg-gray-200 dark:bg-slate-700/70",
    label: "you can't see",
  },
] as const;

type BarKind = (typeof BAR_KINDS)[number]["key"];

const toBarKind = (job: FlowJob): BarKind | null => {
  if (job.status === "completed") return "completed";
  if (job.status === "active") return "active";
  if (job.status === "failed") return "failed";
  if (job.status === "removed" || job.status === "unknown") return null;
  return "waiting";
};

const ChildRow = ({
  job,
  queueLabel,
  now,
}: {
  job: FlowJob;
  queueLabel: string | null;
  now: number;
}) => {
  const status = toListStatus(job.status);
  const Icon = status ? STATUS_ICONS[status] : null;
  const took = getFlowTook(job, now);
  const iconColor =
    job.status === "failed"
      ? "text-red-500"
      : job.status === "active"
        ? "text-blue-500"
        : job.status === "completed"
          ? "text-green-500"
          : TEXT_MUTED;
  const label = job.name || `#${job.id}`;

  const content = (
    <>
      <span className={clsx("grid size-4 place-items-center", iconColor)}>
        {Icon ? <Icon aria-hidden="true" className="size-3.5" /> : null}
      </span>
      <span className="min-w-0 truncate font-mono text-xs text-gray-900 dark:text-white">
        {label}
        {queueLabel ? (
          <span className={clsx("font-sans", TEXT_MUTED)}> · {queueLabel}</span>
        ) : null}
      </span>
      <span className={clsx("font-mono text-xs tabular-nums", TEXT_MUTED)}>
        {job.status === "failed"
          ? "Failed"
          : took
            ? formatDuration(took.ms)
            : status
              ? STATUS_LABELS[status]
              : "Removed"}
      </span>
    </>
  );

  const className =
    "grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 py-1.5";
  return job.status === "removed" ? (
    <div className={className}>{content}</div>
  ) : (
    <Link
      to={getJobPath(job.queueName, job.id)}
      className={clsx(
        className,
        "-mx-1.5 rounded-md px-1.5 transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-slate-800/60",
        FOCUS_RING,
      )}
    >
      {content}
    </Link>
  );
};

/**
 * Where a job sits in its flow: its parent, its children, and what either is
 * waiting on. Rendered only for jobs that belong to one.
 */
export const FlowSection = ({
  jobId,
  queueName,
  queue,
}: {
  jobId: string;
  queueName: string;
  queue?: Queue;
}) => {
  const { preferences } = useQueuedash();
  const supportsFlows = queue?.supports.flows === true;
  const linksReq = trpc.flow.links.useQuery(
    { queueName, jobId },
    {
      enabled: supportsFlows,
      refetchInterval: (query) =>
        query.state.error ? false : preferences.refreshIntervalMs,
      retry: false,
    },
  );
  const queuesReq = trpc.queue.list.useQuery(undefined, {
    enabled: supportsFlows,
    staleTime: 30_000,
  });

  const links = linksReq.data;
  if (!supportsFlows || !links) return null;
  const { job, parent, parentHidden, blocksParent, now } = links;
  if (!parent && !parentHidden && job.childCount === 0) return null;

  const queueLabel = (name: string) =>
    queuesReq.data?.find((candidate) => candidate.name === name)?.displayName ??
    name;
  const counts: Record<BarKind, number> = {
    completed: 0,
    active: 0,
    failed: 0,
    waiting: 0,
    hidden: job.hiddenChildren,
  };
  for (const child of job.children) {
    const kind = toBarKind(child);
    if (kind) counts[kind] += 1;
  }
  const visible = [...job.children]
    .sort(byAttention)
    .slice(0, VISIBLE_CHILDREN);
  const notListed = job.childCount - visible.length - job.hiddenChildren;

  return (
    <DetailSection
      title="Flow"
      action={
        <Link
          to={getFlowPath(queueName, jobId)}
          className={clsx(
            "inline-flex items-center gap-1 rounded text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200",
            FOCUS_RING,
          )}
        >
          Open flow
          <ArrowRight aria-hidden="true" className="size-3" />
        </Link>
      }
    >
      <div className="space-y-3">
        {parent ? (
          <Link
            to={getJobPath(parent.queueName, parent.id)}
            className={clsx(
              "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5 transition-colors duration-150 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800/60",
              FOCUS_RING,
            )}
          >
            <span className="min-w-0">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-mono text-[13px] text-gray-900 dark:text-white">
                  {parent.name || `#${parent.id}`}
                </span>
                <span
                  title={parent.id}
                  className={clsx(
                    "shrink-0 rounded-md bg-gray-100 px-1.5 font-mono text-[11px] leading-[18px] dark:bg-slate-800",
                    TEXT_MUTED,
                  )}
                >
                  #{formatJobId(parent.id)}
                </span>
              </span>
              <span className={clsx("mt-0.5 block text-xs", TEXT_MUTED)}>
                Parent · {queueLabel(parent.queueName)}
              </span>
            </span>
            <FlowStatusPill job={parent} />
          </Link>
        ) : parentHidden ? (
          <p className={clsx("text-xs", TEXT_MUTED)}>
            Its parent is in a queue you can't see.
          </p>
        ) : null}

        {blocksParent ? (
          <p className={clsx("text-xs", TEXT_MUTED)}>
            Its parent can't run until this job is retried or removed.
          </p>
        ) : null}

        {job.childCount > 0 ? (
          <div className="space-y-2">
            <div
              role="img"
              aria-label={`${formatCount(job.childCount)} children: ${BAR_KINDS.filter(
                ({ key }) => counts[key] > 0,
              )
                .map(({ key, label }) => `${counts[key]} ${label}`)
                .join(", ")}`}
              className="flex h-2 gap-0.5 overflow-hidden rounded-full"
            >
              {BAR_KINDS.map(({ key, className }) =>
                counts[key] > 0 ? (
                  <i
                    key={key}
                    className={clsx("block", className)}
                    style={{ flexGrow: counts[key] }}
                  />
                ) : null,
              )}
            </div>
            <p
              className={clsx(
                "flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums",
                TEXT_MUTED,
              )}
            >
              <span>
                <b className="font-semibold text-gray-700 dark:text-slate-200">
                  {formatCount(job.childCount)}
                </b>{" "}
                {job.childCount === 1 ? "child" : "children"}
              </span>
              {BAR_KINDS.map(({ key, label }) =>
                counts[key] > 0 ? (
                  <span key={key}>
                    <b className="font-semibold text-gray-700 dark:text-slate-200">
                      {formatCount(counts[key])}
                    </b>{" "}
                    {label}
                  </span>
                ) : null,
              )}
              {job.unloadedChildren > 0 ? (
                <span>
                  (of the first{" "}
                  {formatCount(job.childCount - job.unloadedChildren)})
                </span>
              ) : null}
            </p>
            <div className="divide-y divide-gray-100/80 dark:divide-slate-800/60">
              {visible.map((child) => (
                <ChildRow
                  key={`${child.queueName}:${child.id}`}
                  job={child}
                  now={now}
                  queueLabel={
                    child.queueName === queueName
                      ? null
                      : queueLabel(child.queueName)
                  }
                />
              ))}
            </div>
            {notListed > 0 ? (
              <p className={clsx("text-xs", TEXT_MUTED)}>
                and {formatCount(notListed)} more in the flow
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </DetailSection>
  );
};
