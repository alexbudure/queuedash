import { TRPCError } from "@trpc/server";

import {
  privacyRedactsGroupIdentity,
  privacyRedactsJobIdentity,
  privacyRedactsPath,
} from "./presentation";
import type {
  InternalContext,
  QueuedashAccessConfig,
  QueuedashAccessMode,
  QueuedashAction,
} from "./trpc";

export const QUEUEDASH_ACTIONS = [
  "queue.pause",
  "queue.resume",
  "queue.empty",
  "queue.clean",
  "queue.setConcurrency",
  "queue.setRateLimit",
  "queue.clearRateLimit",
  "job.add",
  "job.retry",
  "job.promote",
  "job.discard",
  "job.rerun",
  "job.remove",
  "job.update",
  "job.changeDelay",
  "job.changePriority",
  "job.removeDeduplication",
  "scheduler.add",
  "scheduler.update",
  "scheduler.remove",
] as const satisfies readonly QueuedashAction[];

export type ResolvedQueueAccess = {
  actions: Record<QueuedashAction, boolean>;
  deniedActions: QueuedashAction[];
  mode: QueuedashAccessMode;
};

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Access is resolved on every procedure call, so each pattern is compiled
// once rather than per queue per call. The patterns come from the host's
// config, but a bound keeps a long-lived server from growing without limit;
// the oldest pattern goes first.
const MAX_COMPILED_QUEUE_PATTERNS = 1_000;
const compiledQueuePatterns = new Map<string, RegExp>();

const matchesQueuePattern = (queueName: string, pattern: string): boolean => {
  let compiled = compiledQueuePatterns.get(pattern);
  if (!compiled) {
    const expression = pattern
      .split("*")
      .map((part) => escapeRegExp(part))
      .join(".*");
    compiled = new RegExp(`^${expression}$`, "u");
    if (compiledQueuePatterns.size >= MAX_COMPILED_QUEUE_PATTERNS) {
      const oldest = compiledQueuePatterns.keys().next().value;
      if (oldest !== undefined) compiledQueuePatterns.delete(oldest);
    }
    compiledQueuePatterns.set(pattern, compiled);
  }
  return compiled.test(queueName);
};

export const resolveQueueAccess = (
  queueName: string,
  access?: QueuedashAccessConfig,
  privacy?: InternalContext["privacy"],
): ResolvedQueueAccess => {
  let mode: QueuedashAccessMode = access?.default ?? "full";
  const denied = new Set<QueuedashAction>();

  for (const rule of access?.rules ?? []) {
    if (
      !rule.queues.some((pattern) => matchesQueuePattern(queueName, pattern))
    ) {
      continue;
    }

    if (rule.mode) mode = rule.mode;
    for (const action of rule.deny ?? []) denied.add(action);
  }

  if (
    privacyRedactsJobIdentity(privacy) ||
    privacyRedactsGroupIdentity(privacy)
  ) {
    for (const action of [
      "job.retry",
      "job.promote",
      "job.discard",
      "job.rerun",
      "job.remove",
      "job.update",
      "job.changeDelay",
      "job.changePriority",
      "job.removeDeduplication",
    ] as const) {
      denied.add(action);
    }
  }
  if (privacyRedactsPath(privacy, ["key"])) {
    denied.add("scheduler.update");
    denied.add("scheduler.remove");
  }

  const actions = Object.fromEntries(
    QUEUEDASH_ACTIONS.map((action) => [
      action,
      mode === "full" && !denied.has(action),
    ]),
  ) as Record<QueuedashAction, boolean>;

  return {
    actions,
    deniedActions: QUEUEDASH_ACTIONS.filter((action) => !actions[action]),
    mode,
  };
};

export const assertQueueActionAllowed = (
  ctx: InternalContext,
  queueName: string,
  action: QueuedashAction,
): void => {
  if (!ctx.queues.some(({ adapter }) => adapter.getName() === queueName)) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Queue not found",
    });
  }

  const access = resolveQueueAccess(queueName, ctx.access, ctx.privacy);
  if (access.actions[action]) return;

  throw new TRPCError({
    code: "FORBIDDEN",
    message:
      access.mode === "read-only"
        ? `Queue "${queueName}" is read-only`
        : `Action "${action}" is disabled for queue "${queueName}"`,
  });
};
