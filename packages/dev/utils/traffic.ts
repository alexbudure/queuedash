/**
 * Steady demo traffic for the dev app, for screenshots: the charts cover the
 * last hour, and a Reset puts every seed job in one minute, so they need about
 * an hour of this to lose the spike. Run beside `pnpm dev`:
 *
 *   pnpm traffic        # 70 minutes
 *   pnpm traffic 20     # 20 minutes
 */
import { nameFor, queues } from "./fake-data";

const minutes = Number(process.argv[2] ?? 70);
const stopAt = Date.now() + minutes * 60_000;

/** Jobs a minute per queue: busy queues busy, reports rare. */
const RATE_PER_MINUTE: Record<string, number> = {
  "payment-processing": 12,
  "email-delivery": 20,
  "order-fulfillment": 8,
  "image-processing": 10,
  "webhook-delivery": 14,
  "report-generation": 2,
  "search-indexing": 18,
  "session-cleanup": 6,
};

const pick = <T>(items: T[]): T =>
  items[Math.floor(Math.random() * items.length)] as T;

const addOne = async (item: (typeof queues)[number]) => {
  switch (item.type) {
    case "bullmq": {
      const spec = pick(item.jobs);
      // Now, not in an hour: a seed job's delay is for a delayed tab to show.
      const { delay: _delay, ...opts } = spec.opts ?? {};
      await item.queue.add(nameFor(spec.data), spec.data, opts);
      return;
    }
    case "bull": {
      const spec = pick(item.jobs);
      const { delay: _delay, ...opts } = spec.opts ?? {};
      await item.queue.add(spec.data, opts);
      return;
    }
    case "bee": {
      await item.queue.createJob(pick(item.jobs).data).save();
      return;
    }
    case "groupmq": {
      const spec = pick(item.jobs);
      await item.queue.add({ groupId: spec.groupId, data: spec.data });
      return;
    }
  }
};

/** Image jobs that fail the way the Errors tab and the job panel show best. */
const addDemoFailure = async () => {
  const images = queues.find(
    (item) => item.type === "bullmq" && item.queue.name === "image-processing",
  );
  if (images?.type !== "bullmq") return;
  const spec = pick(images.jobs);
  await images.queue.add(
    "thumbnail",
    { ...spec.data, operation: "thumbnail", demoErrors: ["pixel-limit"] },
    { attempts: 1 },
  );
};

const schedule = (task: () => Promise<void>, perMinute: number) => {
  const next = () => {
    if (Date.now() >= stopAt) return;
    // Exponential gaps, so arrivals bunch and thin out like real traffic.
    const gap = -Math.log(1 - Math.random()) * (60_000 / perMinute);
    setTimeout(() => {
      task().catch((error: unknown) => console.error(error));
      next();
    }, gap);
  };
  next();
};

for (const item of queues) {
  const rate = RATE_PER_MINUTE[item.queue.name];
  if (rate) schedule(() => addOne(item), rate);
}
schedule(addDemoFailure, 0.2);

console.log(`Adding demo traffic for ${minutes} minutes.`);
setTimeout(
  () => {
    console.log("Done.");
    process.exit(0);
  },
  stopAt - Date.now() + 1_000,
);
