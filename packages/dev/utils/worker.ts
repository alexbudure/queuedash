import { queues } from "./fake-data";
import Bull from "bull";
import { Queue as BullMQQueue, Worker, MetricsTime } from "bullmq";
import { Worker as GroupMQWorker } from "groupmq";
import BeeQueue from "bee-queue";

const sleep = (t: number) =>
  new Promise((resolve) => setTimeout(resolve, t * 1000));

for (const item of queues) {
  if (item.type === "bull") {
    new Bull(item.queue.name).process(async (job) => {
      await sleep(Math.random() * 20);

      const completedCount = await job.queue.getCompletedCount();

      if (completedCount === 48) {
        throw new Error("Generic error");
      }

      return Promise.resolve();
    });
  } else if (item.type === "bullmq") {
    new Worker(
      item.queue.name,
      async (job) => {
        await sleep(Math.random() * 20);

        job.log("Test log 1");
        job.log("Test log 2");
        const queue = new BullMQQueue(item.queue.name);

        const completedCount = await queue.getCompletedCount();

        if (completedCount === 48) {
          throw new Error("Generic error");
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
  } else if (item.type === "groupmq") {
    const worker = new GroupMQWorker({
      queue: item.queue,
      handler: async () => {
        await sleep(Math.random() * 20);

        const completedCount = await item.queue.getCompletedCount();

        if (completedCount === 48) {
          throw new Error("Generic error");
        }

        return Promise.resolve();
      },
    });
    worker.run();
  } else if (item.type === "bee") {
    new BeeQueue(item.queue.name).process(async (job) => {
      await sleep(Math.random() * 20);

      const completedCount = (await job.queue.checkHealth()).succeeded;

      if (completedCount === 48) {
        throw new Error("Generic error");
      }

      return Promise.resolve();
    });
  }
}
