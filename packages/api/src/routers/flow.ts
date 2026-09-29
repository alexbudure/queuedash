import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { presentJob, privacyRedactsJobIdentity } from "../presentation";
import {
  type FlowChildSet,
  JobNotFoundError,
  type QueueAdapter,
} from "../queue-adapters/base.adapter";
import type { InternalContext } from "../trpc";
import { procedure, router, transformContext } from "../trpc";
import { findQueueInCtxOrFail } from "../utils/global.utils";

// How many children a node shows before "Show more", and how far that goes.
const DEFAULT_CHILD_LIMIT = 50;
const MAX_CHILD_LIMIT = 1_000;
// Bounds on one flow request, however the flow is shaped.
const MAX_FLOW_JOBS = 1_000;
const MAX_FLOW_DEPTH = 8;
const MAX_ANCESTORS = 25;
const LOAD_CONCURRENCY = 25;

type FlowJobStatus =
  | "completed"
  | "failed"
  | "delayed"
  | "active"
  | "prioritized"
  | "waiting"
  | "waiting-children"
  | "paused"
  | "unknown"
  // The flow still names it, but the job itself is gone (removeOnComplete).
  | "removed";

export type FlowJob = {
  queueName: string;
  id: string;
  name: string;
  status: FlowJobStatus;
  createdAt: number | null;
  processedAt: number | null;
  finishedAt: number | null;
  attemptsMade: number;
  attempts: number | null;
  failedReason: string | null;
  // Every child the flow records, loaded or not.
  childCount: number;
  children: FlowJob[];
  // Loaded child keys in queues this viewer cannot see. Counted, never named.
  hiddenChildren: number;
  // Children past the node's limit or the request's bounds.
  unloadedChildren: number;
  // A failed child that holds its parent in waiting-children: added without
  // any failure handling, and still in the parent's pending set.
  blocksParent: boolean;
};

type FlowQueue = {
  adapter: QueueAdapter;
  name: string;
  queueKey: string;
};

const FLOW_STATUSES = new Set<string>([
  "completed",
  "failed",
  "delayed",
  "active",
  "prioritized",
  "waiting",
  "waiting-children",
  "paused",
]);

// Only queues this viewer can see, so a hidden queue's jobs are never read:
// a child whose key matches none of them is counted as hidden.
const getFlowQueues = (ctx: InternalContext): FlowQueue[] =>
  ctx.queues.flatMap(({ adapter }) => {
    const queueKey = adapter.supports.flows
      ? adapter.getQueueKey?.()
      : undefined;
    return queueKey ? [{ adapter, name: adapter.getName(), queueKey }] : [];
  });

// A job key is `${queueKey}:${id}`, and a prefix may itself hold colons, so
// the longest queue key that fits wins.
const locateJob = (
  key: string,
  queues: FlowQueue[],
): { queue: FlowQueue; id: string } | null => {
  let match: FlowQueue | undefined;
  for (const queue of queues) {
    if (
      key.startsWith(`${queue.queueKey}:`) &&
      (!match || queue.queueKey.length > match.queueKey.length)
    ) {
      match = queue;
    }
  }
  return match
    ? { queue: match, id: key.slice(match.queueKey.length + 1) }
    : null;
};

const readAttempts = (opts: unknown): number | null => {
  const attempts = (opts as { attempts?: unknown } | null)?.attempts;
  return typeof attempts === "number" ? attempts : null;
};

const loadFlowJob = async (
  queue: FlowQueue,
  id: string,
  privacy: InternalContext["privacy"],
): Promise<FlowJob> => {
  const [job, status] = await Promise.all([
    queue.adapter.getJob(id),
    queue.adapter.getJobStatus(id),
  ]);
  const base = {
    queueName: queue.name,
    id,
    childCount: 0,
    children: [],
    hiddenChildren: 0,
    unloadedChildren: 0,
    blocksParent: false,
  };
  if (!job) {
    return {
      ...base,
      name: "",
      status: "removed",
      createdAt: null,
      processedAt: null,
      finishedAt: null,
      attemptsMade: 0,
      attempts: null,
      failedReason: null,
    };
  }
  // A flow names jobs and their state; it never needs their data.
  const presented = presentJob(
    { ...job, data: {}, returnValue: undefined },
    privacy,
  );
  return {
    ...base,
    name: presented.name,
    status:
      status && FLOW_STATUSES.has(status)
        ? (status as FlowJobStatus)
        : "unknown",
    createdAt: job.createdAt.getTime(),
    processedAt: job.processedAt?.getTime() ?? null,
    finishedAt: job.finishedAt?.getTime() ?? null,
    attemptsMade: job.attemptsMade ?? 0,
    attempts: readAttempts(presented.opts),
    failedReason: presented.failedReason?.split(/\r?\n/u, 1)[0] ?? null,
  };
};

const inBatches = async <T>(
  items: readonly T[],
  run: (item: T) => Promise<void>,
): Promise<void> => {
  for (let index = 0; index < items.length; index += LOAD_CONCURRENCY) {
    await Promise.all(items.slice(index, index + LOAD_CONCURRENCY).map(run));
  }
};

const getNodeKey = (queueName: string, id: string) => `${queueName}:${id}`;

type Budget = { remaining: number; truncated: boolean };

// Fills in `node`'s children, up to its limit and what the request has left.
const loadChildren = async ({
  budget,
  limit,
  node,
  privacy,
  queue,
  queues,
}: {
  budget: Budget;
  limit: number;
  node: FlowJob;
  privacy: InternalContext["privacy"];
  queue: FlowQueue;
  queues: FlowQueue[];
}): Promise<Array<{ node: FlowJob; queue: FlowQueue }>> => {
  if (!queue.adapter.getJobChildren || node.status === "removed") return [];
  // Reserved before the await, so siblings loading at the same time cannot
  // spend the same budget twice.
  const reserved = Math.max(0, Math.min(limit, budget.remaining));
  budget.remaining -= reserved;

  let children: Awaited<
    ReturnType<NonNullable<QueueAdapter["getJobChildren"]>>
  >;
  try {
    children = await queue.adapter.getJobChildren(node.id, reserved);
  } catch (error) {
    budget.remaining += reserved;
    if (error instanceof JobNotFoundError) return [];
    throw error;
  }
  budget.remaining += reserved - children.keys.length;
  if (children.total > children.keys.length && reserved < limit) {
    budget.truncated = true;
  }

  node.childCount = children.total;
  node.unloadedChildren = children.total - children.keys.length;

  const located: Array<{ queue: FlowQueue; id: string; set: FlowChildSet }> =
    [];
  for (const { key, set } of children.keys) {
    const location = locateJob(key, queues);
    if (location) located.push({ ...location, set });
    else node.hiddenChildren += 1;
  }

  const loaded = await Promise.all(
    located.map(async ({ queue: childQueue, id, set }) => {
      const child = await loadFlowJob(childQueue, id, privacy);
      child.blocksParent = child.status === "failed" && set === "unprocessed";
      return { node: child, queue: childQueue };
    }),
  );
  // On a clock, reading order is start order.
  loaded.sort(
    (left, right) =>
      (left.node.createdAt ?? 0) - (right.node.createdAt ?? 0) ||
      left.node.id.localeCompare(right.node.id),
  );
  node.children = loaded.map(({ node: child }) => child);
  return loaded;
};

const getFlowQueueOrFail = (ctx: InternalContext, queueName: string) => {
  const { adapter } = findQueueInCtxOrFail({ queues: ctx.queues, queueName });
  const queueKey = adapter.supports.flows ? adapter.getQueueKey?.() : undefined;
  if (!queueKey) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${adapter.getType()} queues have no flows`,
    });
  }
  return { adapter, name: adapter.getName(), queueKey };
};

const assertJobLookupAllowed = (ctx: InternalContext) => {
  if (privacyRedactsJobIdentity(ctx.privacy)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Flows are unavailable when job identifiers are redacted",
    });
  }
};

export const flowRouter = router({
  // A job's parent and first children, for the job panel.
  links: procedure
    .input(z.object({ queueName: z.string(), jobId: z.string() }))
    .query(async ({ input: { queueName, jobId }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertJobLookupAllowed(internalCtx);
      const queue = getFlowQueueOrFail(internalCtx, queueName);
      const queues = getFlowQueues(internalCtx);
      const { privacy } = internalCtx;

      const [job, parentRef] = await Promise.all([
        loadFlowJob(queue, jobId, privacy),
        queue.adapter.getJobParent?.(jobId) ?? null,
      ]);
      if (job.status === "removed") return null;

      const parentLocation = parentRef
        ? locateJob(`${parentRef.queueKey}:${parentRef.id}`, queues)
        : null;
      const [parent] = await Promise.all([
        parentLocation
          ? loadFlowJob(parentLocation.queue, parentLocation.id, privacy)
          : null,
        loadChildren({
          budget: { remaining: DEFAULT_CHILD_LIMIT, truncated: false },
          limit: DEFAULT_CHILD_LIMIT,
          node: job,
          privacy,
          queue,
          queues,
        }),
      ]);

      return {
        now: Date.now(),
        job,
        parent,
        parentHidden: Boolean(parentRef && !parentLocation),
        // Failed, added without failure handling, and its parent still
        // waiting: the parent cannot run until this job is retried or removed.
        blocksParent:
          job.status === "failed" &&
          parentRef?.failureHandled === false &&
          parent?.status === "waiting-children",
      };
    }),

  // The whole flow a job belongs to, from its topmost visible ancestor down.
  tree: procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
        // "Show more": a larger child limit for particular nodes, keyed by
        // `${queueName}:${jobId}`.
        childLimits: z
          .record(
            z.string().max(512),
            z.number().int().min(1).max(MAX_CHILD_LIMIT),
          )
          .optional(),
      }),
    )
    .query(async ({ input: { queueName, jobId, childLimits }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertJobLookupAllowed(internalCtx);
      const focusQueue = getFlowQueueOrFail(internalCtx, queueName);
      const queues = getFlowQueues(internalCtx);
      const { privacy } = internalCtx;

      // Up to the topmost ancestor this viewer can see. A parent in a hidden
      // queue ends the walk there; so does one that no longer exists.
      let root = { queue: focusQueue as FlowQueue, id: jobId };
      let parentHidden = false;
      for (let hop = 0; hop < MAX_ANCESTORS; hop += 1) {
        const parentRef = await root.queue.adapter.getJobParent?.(root.id);
        if (!parentRef) break;
        const location = locateJob(
          `${parentRef.queueKey}:${parentRef.id}`,
          queues,
        );
        if (!location) {
          parentHidden = true;
          break;
        }
        if (!(await location.queue.adapter.getJob(location.id))) break;
        root = location;
      }

      const rootJob = await loadFlowJob(root.queue, root.id, privacy);
      if (rootJob.status === "removed") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }

      const budget: Budget = {
        remaining: MAX_FLOW_JOBS - 1,
        truncated: false,
      };
      let level: Array<{ node: FlowJob; queue: FlowQueue }> = [
        { node: rootJob, queue: root.queue },
      ];
      for (let depth = 0; level.length > 0; depth += 1) {
        const next: typeof level = [];
        await inBatches(level, async ({ node, queue }) => {
          const requested =
            childLimits?.[getNodeKey(queue.name, node.id)] ??
            DEFAULT_CHILD_LIMIT;
          // Past the depth bound only the count is read.
          const limit = depth >= MAX_FLOW_DEPTH ? 0 : requested;
          next.push(
            ...(await loadChildren({
              budget,
              limit,
              node,
              privacy,
              queue,
              queues,
            })),
          );
        });
        level = next;
      }

      return {
        now: Date.now(),
        root: rootJob,
        parentHidden,
        // Some children went unread because the request hit its bounds, not
        // the node's own limit.
        truncated: budget.truncated,
        maxChildLimit: MAX_CHILD_LIMIT,
      };
    }),
});
