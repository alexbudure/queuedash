import { procedure, router } from "../trpc";
import Queue from "bull";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { findQueueInCtxOrFail, formatJob } from "../utils/global.utils";

const generateJobMutationProcedure = (
  action: (job: Queue.Job) => Promise<unknown>
) => {
  return procedure
    .input(
      z.object({
        queueName: z.string(),
        jobId: z.string(),
      })
    )
    .mutation(
      async ({ input: { jobId, queueName }, ctx: { queues, opts } }) => {
        const queueInCtx = findQueueInCtxOrFail({
          queues,
          queueName,
        });

        const bullQueue = new Queue(queueInCtx.name, opts);

        const job = await bullQueue.getJob(jobId);

        if (!job) {
          throw new TRPCError({
            code: "BAD_REQUEST",
          });
        }

        try {
          await action(job);
        } catch (e) {
          if (e instanceof TRPCError) {
            throw e;
          } else {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: e instanceof Error ? e.message : undefined,
            });
          }
        }

        return formatJob({ job, queueInCtx });
      }
    );
};

export const jobRouter = router({
  retry: generateJobMutationProcedure(async (job) => {
    if (await job.isFailed()) {
      await job.retry();
    } else {
      throw new TRPCError({
        code: "BAD_REQUEST",
      });
    }
  }),
  discard: generateJobMutationProcedure((job) => job.discard()),
  promote: generateJobMutationProcedure((job) => job.promote()),
  remove: generateJobMutationProcedure((job) => job.remove()),
  list: procedure
    .input(
      z.object({
        queueName: z.string(),
        cursor: z.number().min(0).optional().default(0),
        limit: z.number().min(0).max(100),
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
    .query(
      async ({
        input: { queueName, status, limit, cursor },
        ctx: { queues, opts },
      }) => {
        const queueInCtx = findQueueInCtxOrFail({
          queues,
          queueName,
        });
        try {
          const bullQueue = new Queue(queueInCtx.name, opts);

          const [jobs, totalCountWithWrongType] = await Promise.all([
            bullQueue.getJobs([status], cursor, cursor + limit - 1),
            bullQueue.getJobCountByTypes(status),
          ]);
          const totalCount = totalCountWithWrongType as unknown as number;

          const hasNextPage = jobs.length > 0 && cursor + limit < totalCount;

          return {
            totalCount,
            numOfPages: Math.ceil(totalCount / limit),
            nextCursor: hasNextPage ? cursor + limit : undefined,
            jobs: jobs.map((job) => formatJob({ job, queueInCtx })),
          };
        } catch (e) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: e instanceof Error ? e.message : undefined,
          });
        }
      }
    ),
});
