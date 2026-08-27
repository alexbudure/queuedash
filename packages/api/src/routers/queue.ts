import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import type { RedisInfo } from "redis-info";
import { z } from "zod";

import { assertQueueActionAllowed, resolveQueueAccess } from "../access";
import {
  presentErrorMessage,
  privacyRedactsGroupIdentity,
  privacyRedactsJobIdentity,
  privacyRedactsPath,
  redactValue,
  resolvePrivacyExposure,
} from "../presentation";
import {
  schedulerOptionsSchema,
  schedulerTemplateSchema,
} from "../scheduler.schemas";
import { procedure, router, transformContext } from "../trpc";
import { findQueueInCtxOrFail } from "../utils/global.utils";

const SAFE_ADD_JOB_OPTION_KEYS: Record<
  "bee" | "bull" | "bullmq" | "groupmq",
  ReadonlySet<string>
> = {
  bee: new Set(),
  bull: new Set([
    "attempts",
    "backoff",
    "delay",
    "lifo",
    "priority",
    "removeOnComplete",
    "removeOnFail",
    "timeout",
  ]),
  bullmq: new Set([
    "attempts",
    "backoff",
    "delay",
    "keepLogs",
    "lifo",
    "priority",
    "removeOnComplete",
    "removeOnFail",
    "sizeLimit",
    "stackTraceLimit",
  ]),
  groupmq: new Set([
    "delay",
    "groupId",
    "jobId",
    "maxAttempts",
    "orderMs",
    "runAt",
  ]),
};

const MAX_GROUPMQ_GROUP_ID_LENGTH = 256;
const UNSAFE_GROUPMQ_GROUP_ID_CHARACTERS = /[:\p{Cc}]/u;

const assertSafeAddJobOptions = (
  queueType: keyof typeof SAFE_ADD_JOB_OPTION_KEYS,
  opts?: Record<string, unknown>,
): void => {
  if (!opts) return;
  const allowed = SAFE_ADD_JOB_OPTION_KEYS[queueType];
  const unsupported = Object.keys(opts).filter((key) => !allowed.has(key));
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

      try {
        await queueInCtx.adapter.clean(status, 0);
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: presentErrorMessage(e, internalCtx.privacy),
        });
      }

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

      try {
        await queueInCtx.adapter.empty();
      } catch (e) {
        if (e instanceof TRPCError) {
          throw e;
        } else {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: presentErrorMessage(e, internalCtx.privacy),
          });
        }
      }

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

      try {
        await queueInCtx.adapter.pause();
      } catch (e) {
        if (e instanceof TRPCError) {
          throw e;
        } else {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: presentErrorMessage(e, internalCtx.privacy),
          });
        }
      }

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

      try {
        await queueInCtx.adapter.resume();
      } catch (e) {
        if (e instanceof TRPCError) {
          throw e;
        } else {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: presentErrorMessage(e, internalCtx.privacy),
          });
        }
      }

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

      if (
        opts &&
        Object.keys(opts).length > 0 &&
        !queueInCtx.adapter.supports.addJobOptions
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${queueInCtx.adapter.getType()} does not support job options`,
        });
      }
      assertSafeAddJobOptions(queueInCtx.adapter.getType(), opts);

      try {
        await queueInCtx.adapter.addJob(data, opts);
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: presentErrorMessage(e, internalCtx.privacy),
        });
      }

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

      try {
        await queueInCtx.adapter.addScheduler(
          `scheduler-${randomUUID()}`,
          opts,
          template,
        );
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: presentErrorMessage(e, internalCtx.privacy),
        });
      }

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

      try {
        const [counts, isPaused, redisInfo] = await Promise.all([
          queueInCtx.adapter.getJobCounts(),
          queueInCtx.adapter.isPaused(),
          queueInCtx.adapter.getRedisInfo(),
        ]);

        const info: RedisInfo & { maxclients: string } = {
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
          client: {
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
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: presentErrorMessage(e, internalCtx.privacy),
        });
      }
    }),
  list: procedure.query(async ({ ctx }) => {
    const internalCtx = await transformContext(ctx);
    return internalCtx.queues.map((q) => {
      return {
        displayName: q.adapter.getDisplayName(),
        name: q.adapter.getName(),
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
    });
  }),
  metrics: procedure
    .input(
      z.object({
        queueName: z.string(),
        type: z.enum(["completed", "failed"]),
        start: z.number(),
        end: z.number(),
      }),
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

      try {
        return await queueInCtx.adapter.getMetrics(type, start, end);
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: presentErrorMessage(e, internalCtx.privacy),
        });
      }
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

      try {
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
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: presentErrorMessage(e, internalCtx.privacy),
        });
      }
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

      try {
        const workers = await queueInCtx.adapter.getWorkers();
        const redacted = redactValue(workers, internalCtx.privacy) as Awaited<
          ReturnType<typeof queueInCtx.adapter.getWorkers>
        >;
        return redacted.map((worker, index) => ({
          ...worker,
          id: privacyRedactsPath(internalCtx.privacy, [String(index), "id"])
            ? worker.id
            : (workers[index]?.id ?? worker.id),
        }));
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: presentErrorMessage(e, internalCtx.privacy),
        });
      }
    }),
});
