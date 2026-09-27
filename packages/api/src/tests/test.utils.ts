import { faker } from "@faker-js/faker";
import BeeQueue from "bee-queue";
import Bull from "bull";
import * as BullMQ from "bullmq";
import { Queue as GroupMQQueue, Worker as GroupMQWorker } from "groupmq";
import Redis from "ioredis";
import { afterAll, onTestFinished } from "vitest";

import type { Context } from "../trpc";

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

/**
 * Which BullMQ major the suite runs against. Vitest aliases the `bullmq`
 * specifier to the installed 5.x when this is set, so tests that touch APIs
 * the majors disagree on branch on it.
 */
export const bullmqMajor: 5 | 6 = process.env.BULLMQ_MAJOR === "5" ? 5 : 6;

/**
 * The parts of the raw Redis client the tests reach for. BullMQ 6 hands over a
 * proxy that forwards anything outside its own interface to ioredis, so both
 * majors answer all of these.
 */
type BullMQTestRedisClient = {
  info: () => Promise<string>;
  defineCommand: (
    name: string,
    definition: { numberOfKeys: number; lua: string },
  ) => void;
  set: (key: string, value: string) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
  type: (key: string) => Promise<string>;
};

/**
 * Mirrors the adapter's lookup: BullMQ 6 moved the raw Redis client behind
 * `getBackend()`, where 5 exposed it as `queue.client`.
 */
export const getBullMQRedisClient = async (
  queue: BullMQ.Queue,
): Promise<BullMQTestRedisClient> => {
  const compat = queue as unknown as {
    client?: Promise<BullMQTestRedisClient | undefined>;
    getBackend?: () => { client?: Promise<BullMQTestRedisClient | undefined> };
  };
  const client = await (typeof compat.getBackend === "function"
    ? compat.getBackend().client
    : compat.client);
  if (!client) {
    throw new Error("This BullMQ queue is not backed by Redis");
  }
  return client;
};

// Helper to check if current queue type supports a feature
export const supportsFeature = (feature: keyof typeof featureSupport) => {
  return featureSupport[feature];
};

// Feature support matrix for current queue type
const featureSupport = {
  pause: type !== "bee",
  resume: type !== "bee",
  clean: type !== "bee" && type !== "groupmq",
  retry: type !== "bee" && type !== "groupmq",
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
    }),
  );

  return {
    ctx: { queues } satisfies Context,
    queues,
  };
};

// Helper to expect TRPC error
export const expectTRPCError = async (
  fn: () => Promise<unknown>,
  code?: "BAD_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "INTERNAL_SERVER_ERROR",
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

/**
 * Every suite shares one Redis database, so fixtures are torn down, keys and
 * all; left behind, each run adds thousands of keys. A fixture stops its
 * worker and removes its queue's keys when the test that created it finishes,
 * pass or fail. Two slow steps wait for the end of the file instead: Bull's
 * close(), which gives a worker blocked on an empty queue 500 ms to quit, and
 * removing GroupMQ keys, which has no obliterate() and so takes a keyspace
 * scan, done once for all of the file's queues.
 */
const closingBullQueues: Promise<void>[] = [];
const groupMQNamespaces = new Set<string>();

afterAll(async () => {
  await Promise.all(closingBullQueues);
  if (groupMQNamespaces.size === 0) return;

  const redis = new Redis();
  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        `groupmq:${QUEUE_NAME_PREFIX}-*`,
        "COUNT",
        10_000,
      );
      cursor = next;
      const fixtureKeys = keys.filter((key) =>
        groupMQNamespaces.has(
          key.slice(0, key.indexOf(":", "groupmq:".length)),
        ),
      );
      if (fixtureKeys.length > 0) await redis.unlink(...fixtureKeys);
    } while (cursor !== "0");
  } finally {
    await redis.quit();
  }
});

export const initRedisInstance = async () => {
  switch (type) {
    case "bull": {
      const flightBookingsQueue = {
        queue: new Bull(getFakeQueueName()),
        displayName: QUEUE_DISPLAY_NAME,
        type: "bull" as const,
      };
      onTestFinished(async () => {
        // The queue is also its own worker. obliterate() pauses the queue
        // before removing anything, so the worker takes no further jobs.
        await flightBookingsQueue.queue.obliterate({ force: true });
        const closing = flightBookingsQueue.queue.close();
        // A failed close is reported by the file's afterAll, which awaits it,
        // rather than as an unhandled rejection in whichever test is running.
        closing.catch(() => {});
        closingBullQueues.push(closing);
      });

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
        Array.from({ length: NUM_OF_JOBS }, (_, index) => {
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
      } as {
        queue: BullMQ.Queue;
        displayName: string;
        type: "bullmq";
        worker?: BullMQ.Worker;
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
            maxDataPoints: BullMQ.MetricsTime.ONE_WEEK * 2,
          },
        },
      );

      // Store worker reference to prevent garbage collection
      // This ensures metrics continue to be recorded
      flightBookingsQueue.worker = worker;
      onTestFinished(async () => {
        await worker.close();
        await flightBookingsQueue.queue.obliterate({ force: true });
        await flightBookingsQueue.queue.close();
      });

      await flightBookingsQueue.queue.addBulk(
        Array.from({ length: NUM_OF_JOBS }, (_, index) => {
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

      const schedulers = Array.from({ length: NUM_OF_SCHEDULERS }, () => {
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
      onTestFinished(async () => {
        // close() waits for the active job, after which nothing can write the
        // keys destroy() removes. A closed queue runs no commands, so a second,
        // non-worker handle to the same queue removes them.
        await flightBookingsQueue.queue.close();
        const cleanup = new BeeQueue(flightBookingsQueue.queue.name, {
          isWorker: false,
          getEvents: false,
          sendEvents: false,
        });
        await cleanup.destroy();
        await cleanup.close();
      });

      flightBookingsQueue.queue.process(async (job) => {
        if (job.data.index > NUM_OF_COMPLETED_JOBS) {
          throw new Error("Generic error");
        }

        return Promise.resolve();
      });

      await flightBookingsQueue.queue.saveAll(
        Array.from({ length: NUM_OF_JOBS }, (_, index) => {
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
      groupMQNamespaces.add(flightBookingsQueue.queue.namespace);
      onTestFinished(async () => {
        await worker.close();
        await flightBookingsQueue.queue.close();
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
