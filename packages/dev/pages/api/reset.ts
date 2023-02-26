import type { NextApiRequest, NextApiResponse } from "next";

import { queues } from "../../utils/fake-data";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const pipeline = queues[0].queue.client.pipeline();
  const keys = await queues[0].queue.client.keys("bull*");
  keys.forEach((key) => {
    pipeline.del(key);
  });
  await pipeline.exec();

  for (const item of queues) {
    await item.queue.removeJobs("*");
    await item.queue.addBulk(item.jobs);
  }
  res.status(200).json({ ok: "ok" });
}
