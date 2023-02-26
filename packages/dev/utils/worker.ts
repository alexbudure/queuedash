import { queues } from "./fake-data";
import Bull from "bull";

const sleep = (t: number) =>
  new Promise((resolve) => setTimeout(resolve, t * 1000));

for (const item of queues) {
  new Bull(item.queue.name).process(async (job) => {
    await sleep(Math.random() * 20);

    const completedCount = await job.queue.getCompletedCount();

    if (completedCount === 48) {
      throw new Error("Generic error");
    }

    return Promise.resolve();
  });
}
