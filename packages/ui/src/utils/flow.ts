import { formatDuration } from "./format";
import type { RouterOutput, Status } from "./trpc";

export type FlowTree = RouterOutput["flow"]["tree"];
export type FlowJob = FlowTree["root"];
export type FlowJobStatus = FlowJob["status"];

export const getFlowNodeKey = (job: { queueName: string; id: string }) =>
  `${job.queueName}:${job.id}`;

/**
 * BullMQ 6 gives flow jobs UUIDs, which crowd the name out of a row: a long id
 * shows its first eight characters, enough to tell jobs apart at a glance,
 * with the whole id a hover away.
 */
export const formatJobId = (id: string) =>
  id.length > 12 ? `${id.slice(0, 8)}…` : id;

export const getFlowPath = (queueName: string, jobId: string) =>
  `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}/flow`;

/** Where a job opens in its own queue's list, panel and all. */
export const getJobPath = (queueName: string, jobId: string) =>
  `/queues/${encodeURIComponent(queueName)}?job=${encodeURIComponent(jobId)}`;

const LIST_STATUSES = new Set<string>([
  "completed",
  "failed",
  "delayed",
  "active",
  "prioritized",
  "waiting",
  "waiting-children",
  "paused",
]);

/** The flow statuses a job list also has; "removed" and "unknown" are not. */
export const toListStatus = (status: FlowJobStatus): Status | null =>
  LIST_STATUSES.has(status) ? (status as Status) : null;

const FINISHED = new Set<FlowJobStatus>([
  "completed",
  "failed",
  "removed",
  "unknown",
]);

export const isFlowJobOpen = (job: FlowJob) => !FINISHED.has(job.status);

export const walkFlow = (root: FlowJob): FlowJob[] => {
  const jobs: FlowJob[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const job = pending.pop() as FlowJob;
    jobs.push(job);
    pending.push(...job.children);
  }
  return jobs;
};

export type FlowRow =
  | {
      kind: "job";
      key: string;
      job: FlowJob;
      depth: number;
      parentQueueName: string | null;
      hasChildren: boolean;
      isCollapsed: boolean;
    }
  | { kind: "hidden"; key: string; depth: number; count: number }
  | {
      kind: "more";
      key: string;
      depth: number;
      count: number;
      parent: FlowJob;
    };

/** The tree as table rows, in reading order, skipping collapsed branches. */
export const flattenFlow = (
  root: FlowJob,
  collapsed: ReadonlySet<string>,
): FlowRow[] => {
  const rows: FlowRow[] = [];
  const visit = (
    job: FlowJob,
    depth: number,
    parentQueueName: string | null,
  ) => {
    const key = getFlowNodeKey(job);
    const isCollapsed = collapsed.has(key);
    rows.push({
      kind: "job",
      key,
      job,
      depth,
      parentQueueName,
      hasChildren: job.childCount > 0,
      isCollapsed,
    });
    if (isCollapsed) return;
    for (const child of job.children) visit(child, depth + 1, job.queueName);
    if (job.hiddenChildren > 0) {
      rows.push({
        kind: "hidden",
        key: `${key}#hidden`,
        depth: depth + 1,
        count: job.hiddenChildren,
      });
    }
    if (job.unloadedChildren > 0) {
      rows.push({
        kind: "more",
        key: `${key}#more`,
        depth: depth + 1,
        count: job.unloadedChildren,
        parent: job,
      });
    }
  };
  visit(root, 0, null);
  return rows;
};

/**
 * The span every bar is drawn against: from the first job added to the last
 * one finished, or to now while anything is still waiting or running.
 */
export const getFlowWindow = (root: FlowJob, now: number) => {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  let isOpen = false;
  for (const job of walkFlow(root)) {
    if (job.createdAt !== null) start = Math.min(start, job.createdAt);
    if (job.finishedAt !== null) end = Math.max(end, job.finishedAt);
    if (isFlowJobOpen(job)) isOpen = true;
  }
  if (!Number.isFinite(start)) start = now;
  if (isOpen || !Number.isFinite(end)) end = Math.max(end, now);
  // A flow that ran in an instant still needs a width to draw in.
  if (end - start < 1_000) end = start + 1_000;
  return { start, end, isOpen };
};

const TICK_STEPS_MS = [
  100, 200, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000,
  300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 10_800_000,
  21_600_000, 43_200_000, 86_400_000, 172_800_000, 604_800_000,
];

/** Round offsets from the window's start, at most about `maxTicks` of them. */
export const getFlowTicks = (duration: number, maxTicks = 5): number[] => {
  const step =
    TICK_STEPS_MS.find((candidate) => duration / candidate <= maxTicks) ??
    (TICK_STEPS_MS.at(-1) as number);
  const ticks: number[] = [];
  for (let offset = 0; offset <= duration; offset += step) ticks.push(offset);
  return ticks;
};

export const formatTick = (offset: number) =>
  offset === 0 ? "0s" : formatDuration(offset);

export type FlowSegment = {
  kind: "waiting" | "children" | "running" | "ran" | "failed";
  from: number;
  to: number;
  title: string;
};

/**
 * A job's bar, from what BullMQ records: when it was added, when its last
 * attempt started and when it finished. Earlier failed attempts have no times
 * of their own, so they fold into the waiting before the last one.
 */
export const getFlowSegments = (job: FlowJob, now: number): FlowSegment[] => {
  if (job.createdAt === null) return [];
  const segments: FlowSegment[] = [];
  const hasChildren = job.childCount > 0;
  const startedAt = job.processedAt;
  const waitEnd = startedAt ?? job.finishedAt ?? now;

  if (waitEnd > job.createdAt) {
    const waited = formatDuration(waitEnd - job.createdAt);
    const soFar = startedAt === null && job.finishedAt === null;
    segments.push({
      kind: hasChildren ? "children" : "waiting",
      from: job.createdAt,
      to: waitEnd,
      title: hasChildren
        ? soFar
          ? `Waiting for its children, ${waited} so far`
          : `Waited ${waited} for its children`
        : soFar
          ? `Waiting, ${waited} so far`
          : job.attemptsMade > 1
            ? `Waited ${waited}, including ${job.attemptsMade - 1} earlier ${
                job.attemptsMade === 2 ? "attempt" : "attempts"
              }`
            : `Waited ${waited}`,
    });
  }

  if (startedAt !== null) {
    if (job.finishedAt !== null) {
      const ran = formatDuration(job.finishedAt - startedAt);
      segments.push({
        kind: job.status === "failed" ? "failed" : "ran",
        from: startedAt,
        to: job.finishedAt,
        title:
          job.status === "failed"
            ? `Last attempt ran ${ran} and failed`
            : `Ran ${ran}`,
      });
    } else if (job.status === "active") {
      segments.push({
        kind: "running",
        from: startedAt,
        to: now,
        title: `Running for ${formatDuration(now - startedAt)}`,
      });
    } else {
      // An attempt failed and the next is waiting out its backoff.
      segments.push({
        kind: "waiting",
        from: startedAt,
        to: now,
        title: `Waiting to retry, ${formatDuration(now - startedAt)} so far`,
      });
    }
  }

  return segments;
};

/** How long the job has taken: to finishing, or to now while it is open. */
export const getFlowTook = (job: FlowJob, now: number) =>
  job.createdAt === null
    ? null
    : {
        ms: (job.finishedAt ?? now) - job.createdAt,
        isLive: job.finishedAt === null && isFlowJobOpen(job),
      };

export const summarizeFlow = (root: FlowJob) => {
  const jobs = walkFlow(root);
  const counts = { completed: 0, running: 0, failed: 0, waiting: 0 };
  let hidden = 0;
  for (const job of jobs) {
    hidden += job.hiddenChildren;
    if (job.status === "completed") counts.completed += 1;
    else if (job.status === "active") counts.running += 1;
    else if (job.status === "failed") counts.failed += 1;
    else if (isFlowJobOpen(job)) counts.waiting += 1;
  }
  return {
    jobCount: jobs.length,
    queueCount: new Set(jobs.map(({ queueName }) => queueName)).size,
    hidden,
    counts,
  };
};

/**
 * What a parent in waiting-children is still waiting on. A failed child only
 * counts when it blocks: one added with failure handling no longer does.
 */
export const getWaitingOn = (parent: FlowJob) => {
  if (parent.status !== "waiting-children") return null;
  const blocking = parent.children.filter((child) =>
    child.status === "failed"
      ? child.blocksParent
      : child.status !== "completed" && child.status !== "removed",
  );
  return {
    blocking,
    failed: blocking.filter(({ status }) => status === "failed"),
    running: blocking.filter(({ status }) => status === "active"),
    total: parent.childCount,
  };
};

/** Which jobs a flow action should come first for: problems, then work. */
const ATTENTION_ORDER: Record<FlowJobStatus, number> = {
  failed: 0,
  active: 1,
  "waiting-children": 2,
  waiting: 3,
  prioritized: 3,
  delayed: 4,
  paused: 5,
  completed: 6,
  unknown: 7,
  removed: 8,
};

export const byAttention = (left: FlowJob, right: FlowJob) =>
  ATTENTION_ORDER[left.status] - ATTENTION_ORDER[right.status] ||
  (right.createdAt ?? 0) - (left.createdAt ?? 0);
