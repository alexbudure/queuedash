import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import type { RedisInfo } from "redis-info";
import { z } from "zod";

import { assertQueueActionAllowed, resolveQueueAccess } from "../access";
import {
  privacyRedactsGroupIdentity,
  privacyRedactsJobIdentity,
  privacyRedactsPath,
  redactValue,
  resolvePrivacyExposure,
} from "../presentation";
import type { QueueAdapter, WorkerInfo } from "../queue-adapters/base.adapter";
import { getQueueHealth } from "../queue-health";
import {
  schedulerOptionsSchema,
  schedulerTemplateSchema,
} from "../scheduler.schemas";
import { procedure, router, transformContext } from "../trpc";
import {
  containsPrototypeKey,
  findQueueInCtxOrFail,
} from "../utils/global.utils";

const MAX_GROUPMQ_GROUP_ID_LENGTH = 256;
const UNSAFE_GROUPMQ_GROUP_ID_CHARACTERS = /[:\p{Cc}]/u;
// The metrics adapters' own limit (BullMQ's longest metrics preset). A window
// they would refuse is refused here as a bad request instead: an adapter's
// RangeError reaches the client as a server error.
const MAX_METRICS_WINDOW_MINUTES = 80_640;

const assertSafeAddJobOptions = (
  adapter: QueueAdapter,
  opts?: Record<string, unknown>,
): void => {
  if (!opts) return;
  // Before any key is looked at: zod copies an unknown "__proto__" key into
  // the options it returns by assignment, which makes it their prototype.
  // Their keys then read as empty and pass the allowlist while BullMQ still
  // reads `jobId` through the prototype; a jobId of "wait" turns an idle
  // queue's wait list into a job hash, failing every later add.
  if (
    Object.getPrototypeOf(opts) !== Object.prototype ||
    containsPrototypeKey(opts)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: 'Job options cannot contain a "__proto__" key',
    });
  }

  const queueType = adapter.getType();
  if (Object.keys(opts).length > 0 && !adapter.supports.addJobOptions) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${queueType} does not support job options`,
    });
  }

  const allowed = adapter.supports.addJobOptionKeys;
  const unsupported = Object.keys(opts).filter((key) => !allowed.includes(key));
  if (unsupported.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${queueType} does not support these manual job options: ${unsupported.sort().join(", ")}`,
    });
  }

  const groupId = opts.groupId;
  if (queueType !== "groupmq" || groupId === undefined) return;
  if (
    typeof groupId !== "string" ||
    groupId.length === 0 ||
    groupId.length > MAX_GROUPMQ_GROUP_ID_LENGTH ||
    UNSAFE_GROUPMQ_GROUP_ID_CHARACTERS.test(groupId)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "GroupMQ groupId must be a non-empty string of at most 256 characters without colons or control characters",
    });
  }
};

export const queueRouter = router({
  clean: procedure
    .input(
      z.object({
        queueName: z.string(),
        status: z.string(),
      }),
    )
    .mutation(async ({ input: { queueName, status }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "queue.clean");
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.clean) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support cleaning jobs`,
        });
      }

      if (!queueInCtx.adapter.canCleanStatus(status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support cleaning jobs with status "${status}"`,
        });
      }

      await queueInCtx.adapter.clean(status, 0);

      return {
        name: queueName,
      };
    }),
  empty: procedure
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .mutation(async ({ input: { queueName }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "queue.empty");
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.empty) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support emptying queues`,
        });
      }

      await queueInCtx.adapter.empty();

      return {
        name: queueName,
      };
    }),
  pause: procedure
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .mutation(async ({ input: { queueName }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "queue.pause");
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.pause) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support pausing`,
        });
      }

      await queueInCtx.adapter.pause();

      return {
        name: queueName,
      };
    }),
  pauseAll: procedure.mutation(async ({ ctx }) => {
    const internalCtx = await transformContext(ctx);
    const authorizedQueues = internalCtx.queues.filter(
      ({ adapter }) =>
        resolveQueueAccess(
          adapter.getName(),
          internalCtx.access,
          internalCtx.privacy,
        ).actions["queue.pause"],
    );
    const queues = authorizedQueues.filter(({ adapter }) =>
      Boolean(adapter.supports.pause),
    );
    if (queues.length === 0) {
      throw new TRPCError({
        code: authorizedQueues.length === 0 ? "FORBIDDEN" : "BAD_REQUEST",
        message:
          authorizedQueues.length === 0
            ? "No queues allow pausing"
            : "No queues support pausing",
      });
    }
    await Promise.all(queues.map((q) => q.adapter.pause()));
    return "ok";
  }),
  resume: procedure
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .mutation(async ({ input: { queueName }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "queue.resume");
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.resume) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support resuming`,
        });
      }

      await queueInCtx.adapter.resume();

      return {
        name: queueName,
      };
    }),
  resumeAll: procedure.mutation(async ({ ctx }) => {
    const internalCtx = await transformContext(ctx);
    const authorizedQueues = internalCtx.queues.filter(
      ({ adapter }) =>
        resolveQueueAccess(
          adapter.getName(),
          internalCtx.access,
          internalCtx.privacy,
        ).actions["queue.resume"],
    );
    const queues = authorizedQueues.filter(({ adapter }) =>
      Boolean(adapter.supports.resume),
    );
    if (queues.length === 0) {
      throw new TRPCError({
        code: authorizedQueues.length === 0 ? "FORBIDDEN" : "BAD_REQUEST",
        message:
          authorizedQueues.length === 0
            ? "No queues allow resuming"
            : "No queues support resuming",
      });
    }
    await Promise.all(queues.map((q) => q.adapter.resume()));
    return "ok";
  }),
  addJob: procedure
    .input(
      z.object({
        queueName: z.string(),
        data: z.object({}).passthrough(),
        opts: z.object({}).passthrough().optional(),
      }),
    )
    .mutation(async ({ input: { queueName, data, opts }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "job.add");
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      assertSafeAddJobOptions(queueInCtx.adapter, opts);

      await queueInCtx.adapter.addJob(data, opts);

      return {
        name: queueName,
      };
    }),

  addJobScheduler: procedure
    .input(
      z.object({
        queueName: z.string(),
        template: schedulerTemplateSchema,
        opts: schedulerOptionsSchema,
      }),
    )
    .mutation(async ({ input: { queueName, template, opts }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      assertQueueActionAllowed(internalCtx, queueName, "scheduler.add");
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.schedulers) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support job schedulers`,
        });
      }
      if (!queueInCtx.adapter.addScheduler) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Scheduler support is not implemented for this queue",
        });
      }

      await queueInCtx.adapter.addScheduler(
        `scheduler-${randomUUID()}`,
        opts,
        template,
      );

      return {
        name: queueName,
      };
    }),

  byName: procedure
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .query(async ({ input: { queueName }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      const [counts, isPaused, redisInfo] = await Promise.all([
        queueInCtx.adapter.getJobCounts(),
        queueInCtx.adapter.isPaused(),
        // INFO is in Redis's @dangerous ACL category, so a least-privilege
        // user can be refused it. Only the Redis panel needs it: the queue
        // page and its overview row still load, with the panel unavailable.
        queueInCtx.adapter.getRedisInfo().catch(() => null),
      ]);

      const info: (RedisInfo & { maxclients: string }) | null = redisInfo && {
        ...redisInfo,
        maxclients: redisInfo.maxclients || "0",
      };

      return {
        displayName: queueInCtx.adapter.getDisplayName(),
        name: queueInCtx.adapter.getName(),
        paused: isPaused,
        type: queueInCtx.adapter.getType(),
        supports: {
          ...queueInCtx.adapter.supports,
          groups:
            queueInCtx.adapter.supports.groups &&
            !privacyRedactsGroupIdentity(internalCtx.privacy),
          logs:
            queueInCtx.adapter.supports.logs &&
            !privacyRedactsJobIdentity(internalCtx.privacy),
          // A flow is looked up job by job, which redacted ids rule out.
          flows:
            queueInCtx.adapter.supports.flows &&
            !privacyRedactsJobIdentity(internalCtx.privacy),
          schedulerUpdate:
            queueInCtx.adapter.supports.schedulerUpdate &&
            resolvePrivacyExposure(internalCtx.privacy).schedulerData &&
            !internalCtx.privacy?.redact,
        },
        access: resolveQueueAccess(
          queueName,
          internalCtx.access,
          internalCtx.privacy,
        ),
        counts: {
          active: counts.active || 0,
          completed: counts.completed || 0,
          delayed: counts.delayed || 0,
          failed: counts.failed || 0,
          waiting: counts.waiting || 0,
          prioritized: counts.prioritized || 0,
          "waiting-children": counts["waiting-children"] || 0,
          paused: counts.paused || 0,
        },
        client: info && {
          usedMemoryPercentage:
            Number(info.used_memory) / Number(info.total_system_memory),
          usedMemoryHuman: info.used_memory_human,
          totalMemoryHuman: info.total_system_memory_human,
          uptimeInSeconds: Number(info.uptime_in_seconds),
          connectedClients: Number(info.connected_clients),
          blockedClients: Number(info.blocked_clients),
          maxClients: info.maxclients ? Number(info.maxclients) : 0,
          version: info.redis_version,
        },
      };
    }),
  list: procedure.query(async ({ ctx }) => {
    const internalCtx = await transformContext(ctx);
    return Promise.all(
      internalCtx.queues.map(async (q) => {
        const health = await getQueueHealth(q.adapter);

        return {
          displayName: q.adapter.getDisplayName(),
          name: q.adapter.getName(),
          paused: health?.paused ?? null,
          failedCount: health?.failedCount ?? null,
          supports: {
            pause: q.adapter.supports.pause,
            resume: q.adapter.supports.resume,
          },
          access: resolveQueueAccess(
            q.adapter.getName(),
            internalCtx.access,
            internalCtx.privacy,
          ),
        };
      }),
    );
  }),
  metrics: procedure
    .input(
      z
        .object({
          queueName: z.string(),
          type: z.enum(["completed", "failed"]),
          // Whole minutes ago, counted back from now, with an exclusive end.
          start: z.number().int().min(0),
          end: z.number().int(),
        })
        .refine(
          ({ start, end }) =>
            end > start && end - start <= MAX_METRICS_WINDOW_MINUTES,
          {
            message: `A metrics window needs start < end and at most ${MAX_METRICS_WINDOW_MINUTES} minutes`,
          },
        ),
    )
    .query(async ({ input: { queueName, type, start, end }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.metrics) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support metrics`,
        });
      }

      if (!queueInCtx.adapter.getMetrics) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "getMetrics method not implemented",
        });
      }

      return queueInCtx.adapter.getMetrics(type, start, end);
    }),
  groups: procedure
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .query(async ({ input: { queueName }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.groups) {
        return [];
      }
      if (privacyRedactsGroupIdentity(internalCtx.privacy)) return [];

      const groups = await queueInCtx.adapter.getGroups();
      const redacted = redactValue(groups, internalCtx.privacy) as Awaited<
        ReturnType<typeof queueInCtx.adapter.getGroups>
      >;
      return redacted.map((group, index) => ({
        ...group,
        id: privacyRedactsPath(internalCtx.privacy, [String(index), "id"])
          ? group.id
          : (groups[index]?.id ?? group.id),
      }));
    }),
  workers: procedure
    .input(
      z.object({
        queueName: z.string(),
      }),
    )
    .query(async ({ input: { queueName }, ctx }) => {
      const internalCtx = await transformContext(ctx);
      const queueInCtx = findQueueInCtxOrFail({
        queues: internalCtx.queues,
        queueName,
      });

      if (!queueInCtx.adapter.supports.workers) {
        return [];
      }

      const workers = await queueInCtx.adapter.getWorkers();
      // Null is "this Redis cannot be asked", which the dashboard must show as
      // unavailable rather than as a queue nobody is processing.
      if (workers === null) return null;
      const redacted = redactValue(
        workers,
        internalCtx.privacy,
      ) as WorkerInfo[];
      return redacted.map((worker, index) => ({
        ...worker,
        id: privacyRedactsPath(internalCtx.privacy, [String(index), "id"])
          ? worker.id
          : (workers[index]?.id ?? worker.id),
      }));
    }),
});
