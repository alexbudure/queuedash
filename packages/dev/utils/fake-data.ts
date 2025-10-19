import Bull from "bull";
import type { JobsOptions as BullMQJobOptions, RepeatOptions } from "bullmq";
import { Queue as BullMQQueue } from "bullmq";
import { faker } from "@faker-js/faker";

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
  // {
  //   queue: new Bull("check-in-reminders"),
  //   type: "bull" as const,
  //   displayName: "Check-in reminders",
  //   jobs: [...new Array(50)].map(() => {
  //     return {
  //       data: {
  //         from: faker.location.city(),
  //       },
  //       opts: {},
  //     };
  //   }),
  //   jobName: (job) => {
  //     return `${job.from}`;
  //   },
  // },
  // {
  //   queue: new Bull("monthly-promos"),
  //   type: "bull" as const,
  //   displayName: "Monthly promos",
  //   jobs: [...new Array(50)].map(() => {
  //     return {
  //       data: {
  //         from: faker.location.city(),
  //       },
  //       opts: {},
  //     };
  //   }),
  //   jobName: (job: Record<string, unknown>) => {
  //     return `${job.from}`;
  //   },
  // },
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
];
