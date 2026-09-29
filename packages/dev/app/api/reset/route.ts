import { FlowProducer } from "bullmq";
import { NextResponse } from "next/server";

import { crossQueueFlows, nameFor, queues } from "../../../utils/fake-data";

export async function GET() {
  for (const item of queues) {
    if (item.type === "bull") {
      const client = await item.queue.client;
      const pipeline = client.pipeline();
      const keys = await client.keys(`bull:${item.queue.name}:*`);
      keys.forEach((key) => {
        pipeline.del(key);
      });
      await pipeline.exec();
      await item.queue.removeJobs("*");
      await item.queue.addBulk(item.jobs);
    } else if (item.type === "bullmq") {
      await item.queue.obliterate({ force: true });
      for (const scheduler of item.schedulers) {
        await item.queue.upsertJobScheduler(
          scheduler.name,
          scheduler.opts,
          scheduler.template,
        );
      }
      // Named the way the traffic names them, so a seed job reads like one a
      // producer added (and the Job types tab has no "test" row).
      await item.queue.addBulk(
        item.jobs.map((job) => ({ name: nameFor(job.data), ...job })),
      );

      if (item.flows.length > 0) {
        const flowProducer = new FlowProducer({ connection: {} });

        for (const flow of item.flows) {
          await flowProducer.add({
            name: flow.name,
            queueName: item.queue.name,
            data: flow.data,
            children: flow.children.map((child) => ({
              name: child.name,
              queueName: item.queue.name,
              data: child.data,
            })),
          });
        }

        await flowProducer.close();
      }
    } else if (item.type === "bee") {
      await item.queue.destroy();
      for (const jobData of item.jobs) {
        const job = item.queue.createJob(jobData.data);
        await job.save();
      }
    } else if (item.type === "groupmq") {
      const client = await item.queue.redis;
      const pipeline = client.pipeline();
      const keys = await client.keys("groupmq*");
      keys.forEach((key) => {
        pipeline.del(key);
      });
      await pipeline.exec();
      for (const jobData of item.jobs) {
        await item.queue.add({
          data: jobData.data,
          groupId: jobData.groupId,
        });
      }
    }
  }
  // After every queue is reset: these flows span several of them.
  const flowProducer = new FlowProducer({ connection: {} });
  for (const flow of crossQueueFlows()) {
    await flowProducer.add(flow);
  }
  await flowProducer.close();

  return NextResponse.json({ ok: "ok" });
}
