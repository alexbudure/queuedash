import { procedure, router } from "../trpc";
import { z } from "zod";
import { findQueueInCtxOrFail, opts } from "../utils/global.utils";
import Queue from "bull";
import { parse } from "redis-info";
import { TRPCError } from "@trpc/server";

const generateQueueMutationProcedure = (action: (job: Queue.Queue) => void) => {
  return procedure
    .input(
      z.object({
        queueName: z.string(),
      })
    )
    .mutation(async ({ input: { queueName }, ctx: { queues } }) => {
      const queueInCtx = findQueueInCtxOrFail({
        queues,
        queueName,
      });

      const bullQueue = new Queue(queueInCtx.name, opts);

      try {
        await action(bullQueue);
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: e instanceof Error ? e.message : undefined,
        });
      }

      return {
        name: queueName,
      };
    });
};

export const queueRouter = router({
  clean: procedure
    .input(
      z.object({
        queueName: z.string(),
        status: z.enum([
          "completed",
          "failed",
          "delayed",
          "active",
          "waiting",
          "paused",
        ] as const),
      })
    )
    .mutation(async ({ input: { queueName, status }, ctx: { queues } }) => {
      const queueInCtx = findQueueInCtxOrFail({
        queues,
        queueName,
      });

      const bullQueue = new Queue(queueInCtx.name, opts);

      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        await bullQueue.clean(0, status);
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: e instanceof Error ? e.message : undefined,
        });
      }

      return {
        name: queueName,
      };
    }),
  empty: generateQueueMutationProcedure((queue) => queue.empty()),
  pause: generateQueueMutationProcedure((queue) => queue.pause()),
  resume: generateQueueMutationProcedure((queue) => queue.resume()),
  addJob: generateQueueMutationProcedure((queue) => queue.add("")),

  byName: procedure
    .input(
      z.object({
        queueName: z.string(),
      })
    )
    .query(async ({ input: { queueName }, ctx: { queues } }) => {
      const queueInCtx = findQueueInCtxOrFail({
        queues,
        queueName,
      });

      const bullQueue = new Queue(queueInCtx.name, opts);

      try {
        const [counts, info, isPaused] = await Promise.all([
          bullQueue.getJobCounts(),
          bullQueue.client.info(),
          bullQueue.isPaused(),
        ]);
        const parsedInfo = parse(info);

        return {
          displayName: queueInCtx.displayName,
          name: queueInCtx.name,
          paused: isPaused,
          client: {
            connectedClients: parsedInfo.connected_clients,
            blockedClients: parsedInfo.blocked_clients,
            version: parsedInfo.redis_version,
          },
          counts: {
            active: counts.active,
            completed: counts.completed,
            delayed: counts.delayed,
            failed: counts.failed,
            waiting: counts.waiting,
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            paused: counts.paused as number,
          },
        };
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: e instanceof Error ? e.message : undefined,
        });
      }
    }),
  list: procedure.query(async ({ ctx: { queues } }) => {
    return queues.map((queue) => {
      return {
        displayName: queue.displayName,
        name: queue.name,
      };
    });
  }),
});
