import Bull from "bull";
import { faker } from "@faker-js/faker";
import type { Context } from "../trpc";
import BullMQ from "bullmq";
import BeeQueue from "bee-queue";

export const NUM_OF_JOBS = 20;
export const NUM_OF_COMPLETED_JOBS = NUM_OF_JOBS / 2;
export const NUM_OF_FAILED_JOBS = NUM_OF_JOBS / 2;
const QUEUE_NAME_PREFIX = "flight-bookings";
const QUEUE_DISPLAY_NAME = "Flight bookings";

const getFakeQueueName = () =>
  `${QUEUE_NAME_PREFIX}-${faker.string.alpha({ length: 5 })}`;

export const sleep = (t: number) =>
  new Promise((resolve) => setTimeout(resolve, t));

type QueueType = "bull" | "bullmq" | "bee";

export const type: QueueType =
  (process.env.QUEUE_TYPE as unknown as QueueType) || "bee";

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

      new BullMQ.Worker(flightBookingsQueue.queue.name, async (job) => {
        if (job.data.index > NUM_OF_COMPLETED_JOBS) {
          throw new Error("Generic error");
        }

        return Promise.resolve();
      });

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
  }
};
