import Bull from "bull";
import { faker } from "@faker-js/faker";
import type { Context } from "../trpc";
import BullMQ, { MetricsTime } from "bullmq";
import BeeQueue from "bee-queue";
import { Queue as GroupMQQueue, Worker as GroupMQWorker } from "groupmq";
import Redis from "ioredis";

export const NUM_OF_JOBS = 20;
export const NUM_OF_SCHEDULERS = 3;
export const NUM_OF_COMPLETED_JOBS = 7; // Different from failed to catch wrong metrics type bugs
export const NUM_OF_FAILED_JOBS = 13; // Different from completed to catch wrong metrics type bugs
export const NUM_OF_WAITING_CHILDREN_JOBS = 2;
const QUEUE_NAME_PREFIX = "flight-bookings";
const QUEUE_DISPLAY_NAME = "Flight bookings";

const getFakeQueueName = () =>
  `${QUEUE_NAME_PREFIX}-${faker.string.alpha({ length: 5 })}`;

export const sleep = (t: number) =>
  new Promise((resolve) => setTimeout(resolve, t));

type QueueType = "bull" | "bullmq" | "bee" | "groupmq";

export const type: QueueType =
  (process.env.QUEUE_TYPE as unknown as QueueType) || "groupmq";

// Helper to check if current queue type supports a feature
export const supportsFeature = (feature: keyof typeof featureSupport) => {
  return featureSupport[feature];
};

// Feature support matrix for current queue type
const featureSupport = {
  pause: type !== "bee",
  resume: type !== "bee",
  clean: type !== "bee",
  retry: type !== "bee",
  promote: type === "bullmq" || type === "groupmq",
  logs: type === "bullmq",
  schedulers: type === "bullmq",
  empty: type !== "groupmq" && type !== "bee",
} as const;

// Helper to create multiple queues for multi-queue tests
export const initMultipleQueues = async (count: number = 2) => {
  const queues = await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const instance = await initRedisInstance();
      return {
        ...instance.firstQueue,
        displayName: `${QUEUE_DISPLAY_NAME} ${i + 1}`,
      };
    })
  );

  return {
    ctx: { queues } satisfies Context,
    queues,
  };
};

// Helper to expect TRPC error
export const expectTRPCError = async (
  fn: () => Promise<any>,
  code?: "BAD_REQUEST" | "NOT_FOUND" | "INTERNAL_SERVER_ERROR"
) => {
  const { TRPCError } = await import("@trpc/server");
  try {
    await fn();
    throw new Error("Expected function to throw TRPCError");
  } catch (e) {
    if (!(e instanceof TRPCError)) {
      throw e;
    }
    if (code && e.code !== code) {
      throw new Error(`Expected error code ${code}, got ${e.code}`);
    }
    return e;
  }
};

export const initRedisInstance = async () => {
  switch (type) {
    case "bull": {
      const flightBookingsQueue = {
        queue: new Bull(getFakeQueueName()),
        displayName: QUEUE_DISPLAY_NAME,
        type: "bull" as const,
      };

      flightBookingsQueue.queue.process(async (job) => {
        if (job.data.index > NUM_OF_COMPLETED_JOBS) {
          throw new Error("Generic error");
        }

        // Return a value for job with index 1 to test returnValue
        if (job.data.index === 1) {
          return { processed: true, index: job.data.index };
        }

        return Promise.resolve();
      });

      await flightBookingsQueue.queue.addBulk(
        [...new Array(NUM_OF_JOBS)].map((_, index) => {
          return {
            data: {
              index: index + 1,
            },
          };
        }),
      );

      await sleep(200);

      return {
        ctx: {
          queues: [flightBookingsQueue],
        } satisfies Context,
        firstQueue: flightBookingsQueue,
      };
    }
    case "bullmq": {
      const flightBookingsQueue = {
        queue: new BullMQ.Queue(getFakeQueueName()),
        displayName: QUEUE_DISPLAY_NAME,
        type: "bullmq" as const,
      };

      // Create and store Worker reference to keep it alive for metrics collection
      const worker = new BullMQ.Worker(
        flightBookingsQueue.queue.name,
        async (job) => {
          if (job.data.index > NUM_OF_COMPLETED_JOBS) {
            throw new Error("Generic error");
          }

          // Return a value for job with index 1 to test returnValue
          if (job.data.index === 1) {
            return { processed: true, index: job.data.index };
          }

          return Promise.resolve();
        },
        {
          connection: {},
          metrics: {
            maxDataPoints: MetricsTime.ONE_WEEK * 2,
          },
        },
      );

      // Store worker reference to prevent garbage collection
      // This ensures metrics continue to be recorded
      (flightBookingsQueue as any).worker = worker;

      await flightBookingsQueue.queue.addBulk(
        [...new Array(NUM_OF_JOBS)].map((_, index) => {
          return {
            name: "test",
            data: {
              index: index + 1,
            },
          };
        }),
      );

      // Add jobs with children to create waiting-children jobs using FlowProducer
      const flowProducer = new BullMQ.FlowProducer({ connection: {} });

      for (let i = 0; i < NUM_OF_WAITING_CHILDREN_JOBS; i++) {
        await flowProducer.add({
          name: "parent-job",
          queueName: flightBookingsQueue.queue.name,
          data: { parentIndex: i },
          children: [
            {
              name: "child-job",
              queueName: flightBookingsQueue.queue.name,
              data: { childIndex: i },
              opts: {
                delay: 10000, // Delay child jobs so parent stays in waiting-children
              },
            },
          ],
        });
      }

      await flowProducer.close();

      const schedulers = [...new Array(NUM_OF_SCHEDULERS)].map(() => {
        return {
          name: faker.person.fullName(),
          template: {
            name: faker.person.fullName(),
            data: {
              name: faker.person.fullName(),
            },
          },
          opts: {
            pattern: "0 0 * * *",
            tz: "America/Los_Angeles",
          },
        };
      });

      for (const scheduler of schedulers) {
        await flightBookingsQueue.queue.upsertJobScheduler(
          scheduler.name,
          scheduler.opts,
          scheduler.template,
        );
      }

      await sleep(200);

      return {
        ctx: {
          queues: [flightBookingsQueue],
        } satisfies Context,
        firstQueue: flightBookingsQueue,
      };
    }
    case "bee": {
      const flightBookingsQueue = {
        queue: new BeeQueue(getFakeQueueName()),
        displayName: QUEUE_DISPLAY_NAME,
        type: "bee" as const,
      };

      flightBookingsQueue.queue.process(async (job) => {
        if (job.data.index > NUM_OF_COMPLETED_JOBS) {
          throw new Error("Generic error");
        }

        return Promise.resolve();
      });

      await flightBookingsQueue.queue.saveAll(
        [...new Array(NUM_OF_JOBS)].map((_, index) => {
          return flightBookingsQueue.queue.createJob({
            index: index + 1,
          });
        }),
      );

      await sleep(200);

      return {
        ctx: {
          queues: [flightBookingsQueue],
        } satisfies Context,
        firstQueue: flightBookingsQueue,
      };
    }
    case "groupmq": {
      const redis = new Redis();

      const flightBookingsQueue = {
        queue: new GroupMQQueue({
          redis,
          namespace: getFakeQueueName(),
          keepFailed: NUM_OF_JOBS,
          keepCompleted: NUM_OF_JOBS,
        }),
        displayName: QUEUE_DISPLAY_NAME,
        type: "groupmq" as const,
      };

      const worker = new GroupMQWorker({
        queue: flightBookingsQueue.queue,
        enableCleanup: true,
        handler: async (job) => {
          if (job.data.index > NUM_OF_COMPLETED_JOBS) {
            throw new Error("Generic error");
          }

          // Return a value for job with index 1 to test returnValue
          if (job.data.index === 1) {
            return { processed: true, index: job.data.index };
          }

          return Promise.resolve();
        },
      });
      worker.run();
      // Add regular jobs with different group IDs
      for (let i = 0; i < NUM_OF_JOBS; i++) {
        await flightBookingsQueue.queue.add({
          groupId: faker.string.uuid(),
          data: {
            index: i + 1,
          },
          maxAttempts: 0,
        });
      }

      await sleep(1000);

      return {
        ctx: {
          queues: [flightBookingsQueue],
        } satisfies Context,
        firstQueue: flightBookingsQueue,
      };
    }
  }
};
