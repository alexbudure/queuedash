import type { NextApiRequest, NextApiResponse } from "next";

import { queues } from "../../utils/fake-data";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const client = await queues[0].queue.client;
  const pipeline = client.pipeline();
  const keys = await client.keys("bull*");
  keys.forEach((key) => {
    pipeline.del(key);
  });
  await pipeline.exec();

  for (const item of queues) {
    if (item.type === "bull") {
      await item.queue.removeJobs("*");
      await item.queue.addBulk(item.jobs);
    } else {
      await item.queue.obliterate({ force: true });
      for (const scheduler of item.schedulers) {
        await item.queue.upsertJobScheduler(
          scheduler.name,
          scheduler.opts,
          scheduler.template,
        );
      }
      await item.queue.addBulk(
        item.jobs.map((job) => {
          return {
            name: "test",
            ...job,
          };
        }),
      );
    }
  }
  res.status(200).json({ ok: "ok" });
}
