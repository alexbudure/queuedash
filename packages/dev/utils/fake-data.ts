import Bull from "bull";
import type { JobsOptions as BullMQJobOptions, RepeatOptions } from "bullmq";
import { Queue as BullMQQueue } from "bullmq";
import { Queue as GroupMQQueue } from "groupmq";
import BeeQueue from "bee-queue";
import { faker } from "@faker-js/faker";
import Redis from "ioredis";

type FakeQueue =
  | {
      queue: Bull.Queue;
      type: "bull";
      displayName: string;
      jobs: { opts: Bull.JobOptions; data: Record<string, unknown> }[];
      jobName: (job: Record<string, unknown>) => string;
    }
  | {
      queue: BullMQQueue;
      type: "bullmq";
      displayName: string;
      jobs: { opts: BullMQJobOptions; data: Record<string, unknown> }[];
      flows: {
        name: string;
        data: Record<string, unknown>;
        children: {
          name: string;
          data: Record<string, unknown>;
        }[];
      }[];
      jobName: (job: Record<string, unknown>) => string;
      schedulers: {
        name: string;
        opts: RepeatOptions;
        template: {
          name?: string | undefined;
          data?: Record<string, unknown>;
          opts?: Omit<
            BullMQJobOptions,
            "jobId" | "repeat" | "delay" | "deduplication" | "debounce"
          >;
        };
      }[];
    }
  | {
      queue: GroupMQQueue;
      type: "groupmq";
      displayName: string;
      jobs: {
        groupId: string;
        data: Record<string, unknown>;
        delay?: number;
      }[];
      jobName: (job: Record<string, unknown>) => string;
    }
  | {
      queue: BeeQueue;
      type: "bee";
      displayName: string;
      jobs: { data: Record<string, unknown> }[];
      jobName: (job: Record<string, unknown>) => string;
    };

export const queues: FakeQueue[] = [
  {
    queue: new Bull("flight-bookings"),
    type: "bull" as const,
    displayName: "Flight bookings",
    jobs: [...new Array(50)].map(() => {
      return {
        data: {
          from: faker.location.city(),
          to: faker.location.city(),
          name: faker.person.fullName(),
          priority: faker.number.int({
            min: 1,
            max: 4,
          }),
          bags: Math.random() > 0.5 ? 1 : 0,
        },
        opts: {
          lifo: true,
          delay: 750,
        },
      };
    }),
    jobName: (job: Record<string, unknown>) => {
      return `${job.from} to ${job.to}`;
    },
  },
  {
    queue: new BullMQQueue("cancellation-follow-ups"),
    type: "bullmq" as const,
    displayName: "Cancellation follow-ups",
    jobs: [...new Array(50)].map((_, index) => {
      return {
        data: {
          name: faker.person.fullName(),
        },
        opts: {
          priority: index === 4 ? undefined : 1,
        },
      };
    }),
    schedulers: [...new Array(3)].map(() => {
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
    }),
    flows: [...new Array(3)].map((_, i) => {
      const name = faker.person.fullName();
      return {
        name: `${name} Parent Flow`,
        data: { parentIndex: i, name: `${name} Parent Flow` },
        children: [
          {
            name: `${name} Child 1 of Parent`,
            data: {
              childIndex: i,
              child: 1,
              name: `${name} Child Job 1 of Parent`,
            },
          },
          {
            name: `${name} Child 2 of Parent`,
            data: {
              childIndex: i,
              child: 2,
              name: `${name} Child Job 2 of Parent`,
            },
          },
        ],
      };
    }),
    jobName: (job: Record<string, unknown>) => {
      return `${job.name}`;
    },
  },
  {
    queue: new GroupMQQueue({
      redis: new Redis(),
      namespace: "order-processing",
      keepCompleted: 100,
      keepFailed: 100,
    }),
    type: "groupmq" as const,
    displayName: "Order processing",
    jobs: [...new Array(50)].map((_, index) => {
      return {
        groupId: `customer-${faker.number.int({ min: 1, max: 10 })}`,
        data: {
          orderId: faker.string.uuid(),
          customer: faker.person.fullName(),
          amount: faker.number.float({ min: 10, max: 1000, fractionDigits: 2 }),
        },
        delay: index % 5 === 0 ? 5000 : undefined,
      };
    }),
    jobName: (job: Record<string, unknown>) => {
      return `Order ${job.orderId}`;
    },
  },
  {
    queue: new BeeQueue("email-notifications"),
    type: "bee" as const,
    displayName: "Email notifications",
    jobs: [...new Array(50)].map(() => {
      return {
        data: {
          to: faker.internet.email(),
          subject: faker.lorem.sentence(),
          template: faker.helpers.arrayElement([
            "welcome",
            "reset-password",
            "order-confirmation",
          ]),
        },
      };
    }),
    jobName: (job: Record<string, unknown>) => {
      return `Email to ${job.to}`;
    },
  },
];
