import BeeQueue from "bee-queue";
import Bull from "bull";
import { Worker, MetricsTime } from "bullmq";
import { Worker as GroupMQWorker } from "groupmq";

import { queues } from "./fake-data";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Random sleep within a range (in seconds)
const sleepRange = (minS: number, maxS: number) =>
  sleep((minS + Math.random() * (maxS - minS)) * 1000);

/**
 * Failures with the stacks a real worker would throw - app frames under /app,
 * library frames under node_modules - for the job panel's screenshots. Demo
 * data asks for them by key: `{ demoErrors: ["upload-timeout", "pixel-limit"] }`
 * fails the first attempt with one and the second with the other.
 */
const DEMO_ERRORS: Record<
  string,
  { name: string; message: string; frames: string[] }
> = {
  "pixel-limit": {
    name: "Error",
    message: "Input image exceeds pixel limit",
    frames: [
      "Sharp.toBuffer (/app/node_modules/sharp/lib/output.js:163:17)",
      "resizeImage (/app/src/images/resize.ts:31:18)",
      "async renderThumbnail (/app/src/images/thumbnail.ts:22:17)",
      "async Worker.processFn (/app/src/workers/images.ts:57:20)",
      "async Worker.processJob (/app/node_modules/bullmq/dist/cjs/classes/worker.js:463:28)",
      "async Worker.retryIfFailed (/app/node_modules/bullmq/dist/cjs/classes/worker.js:627:24)",
    ],
  },
  "upload-timeout": {
    name: "TimeoutError",
    message: "Upload to cdn-uploads timed out after 30000ms",
    frames: [
      "Timeout._onTimeout (/app/node_modules/@smithy/node-http-handler/dist-cjs/index.js:388:26)",
      "listOnTimeout (node:internal/timers:594:17)",
      "process.processTimers (node:internal/timers:529:7)",
      "async uploadVariant (/app/src/storage/cdn.ts:64:5)",
      "async renderThumbnail (/app/src/images/thumbnail.ts:29:3)",
      "async Worker.processFn (/app/src/workers/images.ts:57:20)",
      "async Worker.processJob (/app/node_modules/bullmq/dist/cjs/classes/worker.js:463:28)",
    ],
  },
};

const demoError = (key: string) => {
  const spec = DEMO_ERRORS[key] ?? DEMO_ERRORS["pixel-limit"];
  const error = new Error(spec.message);
  error.name = spec.name;
  error.stack = [
    `${spec.name}: ${spec.message}`,
    ...spec.frames.map((frame) => `    at ${frame}`),
  ].join("\n");
  return error;
};

// Fail with a given probability (0–1)
const maybeFail = (rate: number, messages: string[]) => {
  if (Math.random() < rate) {
    throw new Error(messages[Math.floor(Math.random() * messages.length)]);
  }
};

const ERRORS: Record<string, string[]> = {
  "payment-processing": [
    "Card declined: insufficient funds",
    "Payment gateway timeout after 30000ms",
    "3D Secure authentication failed",
    "Duplicate transaction detected",
    "Currency conversion service unavailable",
  ],
  "email-delivery": [
    "SMTP connection refused: 550 mailbox not found",
    "Rate limit exceeded for domain",
    "Template rendering failed: missing variable 'userName'",
    "Bounce: invalid recipient address",
  ],
  "order-fulfillment": [
    "Item SKU-A8F2K1 out of stock",
    "Shipping address validation failed: invalid ZIP code",
    "Warehouse API returned 503 Service Unavailable",
    "Order total mismatch after tax calculation",
  ],
  "image-processing": [
    "Unsupported image format: HEIC decoding failed",
    "Image dimensions exceed maximum (8192x8192)",
    "Corrupt file: invalid JPEG header",
    "Out of memory: file too large for processing",
    "Timeout: processing exceeded 60s limit",
  ],
  "webhook-delivery": [
    "HTTP 502 Bad Gateway from endpoint",
    "Connection timeout after 10000ms",
    "HTTP 404 Not Found: endpoint removed",
    "SSL certificate verification failed",
    "HTTP 429 Too Many Requests",
    "DNS resolution failed for host",
  ],
  "report-generation": [
    "Query timeout: exceeded 120s limit",
    "Insufficient permissions for data source",
    "Date range too large: max 365 days",
  ],
  "search-indexing": [
    "Elasticsearch cluster unavailable",
    "Index mapping conflict for field 'price'",
  ],
  "session-cleanup": ["Redis SCAN timeout"],
};

for (const item of queues) {
  if (item.type === "bull") {
    new Bull(item.queue.name).process(async (job) => {
      const name = item.queue.name;
      const errors = ERRORS[name] || ["Unknown error"];

      if (name === "order-fulfillment") {
        await sleepRange(0.5, 3);
        maybeFail(0.03, errors);
        return { fulfilled: true, orderId: job.data.orderId };
      }

      if (name === "report-generation") {
        await sleepRange(3, 20);
        maybeFail(0.02, errors);
        return {
          reportUrl: `https://cdn.example.com/reports/${job.data.reportId}.${job.data.format}`,
          generatedAt: new Date().toISOString(),
          rowCount: Math.floor(Math.random() * 50000),
        };
      }

      // Fallback
      await sleepRange(1, 5);
      return { ok: true };
    });
  } else if (item.type === "bullmq") {
    new Worker(
      item.queue.name,
      async (job) => {
        const name = item.queue.name;
        const errors = ERRORS[name] || ["Unknown error"];

        // Demo data can ask to fail: `{ failTimes: 2 }` fails the first two
        // attempts, so the job panel has several to show.
        if (
          typeof job.data.failTimes === "number" &&
          job.attemptsMade < job.data.failTimes
        ) {
          await sleepRange(0.1, 0.4);
          maybeFail(1, errors);
        }
        if (
          Array.isArray(job.data.demoErrors) &&
          job.attemptsMade < job.data.demoErrors.length
        ) {
          await sleepRange(0.2, 0.8);
          throw demoError(String(job.data.demoErrors[job.attemptsMade]));
        }

        if (name === "payment-processing") {
          await sleepRange(0.3, 2);
          await job.log(
            `Processing ${job.data.type} for ${job.data.customerId}`,
          );
          await job.log(`Amount: ${job.data.amount} ${job.data.currency}`);
          maybeFail(0.05, errors);
          return {
            transactionId: `txn_${Date.now()}`,
            status: "succeeded",
          };
        }

        if (name === "email-delivery") {
          await sleepRange(0.1, 0.5);
          await job.log(`Sending ${job.data.template} to ${job.data.to}`);
          maybeFail(0.02, errors);
          return { messageId: `msg_${Date.now()}`, delivered: true };
        }

        if (name === "image-processing") {
          await sleepRange(1, 8);
          await job.log(
            `Processing ${job.data.operation} on ${job.data.fileName}`,
          );
          maybeFail(0.08, errors);
          return {
            outputUrl: `https://cdn.example.com/processed/${job.data.fileId}.webp`,
          };
        }

        if (name === "search-indexing") {
          await sleepRange(0.05, 0.3);
          maybeFail(0.01, errors);
          return { indexed: true, documentId: job.data.documentId };
        }

        // Fallback
        await sleepRange(0.5, 3);
        return { ok: true };
      },
      {
        connection: {},
        // Named, so a job's panel says which worker ran it (processedBy).
        name: `${item.queue.name}-worker`,
        metrics: {
          maxDataPoints: MetricsTime.ONE_WEEK * 2,
        },
      },
    );
  } else if (item.type === "groupmq") {
    const worker = new GroupMQWorker({
      queue: item.queue,
      handler: async () => {
        // Webhooks: 0.2–1.5s, ~12% failure
        await sleepRange(0.2, 1.5);
        maybeFail(0.12, ERRORS["webhook-delivery"]);
        return Promise.resolve();
      },
    });
    worker.run();
  } else if (item.type === "bee") {
    new BeeQueue(item.queue.name).process(async () => {
      // Session cleanup: 0.1–0.3s, ~0.5% failure
      await sleepRange(0.1, 0.3);
      maybeFail(0.005, ERRORS["session-cleanup"]);
      return { cleaned: true };
    });
  }
}
