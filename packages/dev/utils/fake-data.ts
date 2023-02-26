import Bull from "bull";
import { faker } from "@faker-js/faker";

type FakeQueue = {
  queue: Bull.Queue;
  type: "bull";
  displayName: string;
  jobs: { opts: Bull.JobOptions; data: Record<string, unknown> }[];
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
    queue: new Bull("cancellation-follow-ups"),
    type: "bull" as const,
    displayName: "Cancellation follow-ups",
    jobs: [...new Array(50)].map(() => {
      return {
        data: {
          name: faker.name.fullName(),
        },
        opts: {},
      };
    }),
    jobName: (job: Record<string, unknown>) => {
      return `${job.name}`;
    },
  },
];
