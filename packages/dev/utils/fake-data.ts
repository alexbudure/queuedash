import Bull from "bull";
import type { JobsOptions as BullMQJobOptions } from "bullmq";
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
          from: faker.address.city(),
          to: faker.address.city(),
          name: faker.name.fullName(),
          priority: faker.random.numeric(1, {
            bannedDigits: ["0", "5", "6", "7", "8", "9"],
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
    queue: new Bull("check-in-reminders"),
    type: "bull" as const,
    displayName: "Check-in reminders",
    jobs: [...new Array(50)].map(() => {
      return {
        data: {
          from: faker.address.city(),
        },
        opts: {},
      };
    }),
    jobName: (job) => {
      return `${job.from}`;
    },
  },
  {
    queue: new Bull("monthly-promos"),
    type: "bull" as const,
    displayName: "Monthly promos",
    jobs: [...new Array(50)].map(() => {
      return {
        data: {
          from: faker.address.city(),
        },
        opts: {},
      };
    }),
    jobName: (job: Record<string, unknown>) => {
      return `${job.from}`;
    },
  },
  {
    queue: new BullMQQueue("cancellation-follow-ups"),
    type: "bullmq" as const,
    displayName: "Cancellation follow-ups",
    jobs: [...new Array(50)].map((_, index) => {
      return {
        data: {
          name: faker.name.fullName(),
        },
        opts: {
          priority: index === 4 ? undefined : 1,
        },
      };
    }),
    jobName: (job: Record<string, unknown>) => {
      return `${job.name}`;
    },
  },
];
