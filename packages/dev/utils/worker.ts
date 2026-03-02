import { queues } from "./fake-data";
import Bull from "bull";
import { Worker, MetricsTime } from "bullmq";
import { Worker as GroupMQWorker } from "groupmq";
import BeeQueue from "bee-queue";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Random sleep within a range (in seconds)
const sleepRange = (minS: number, maxS: number) =>
  sleep((minS + Math.random() * (maxS - minS)) * 1000);

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

        if (name === "payment-processing") {
          await sleepRange(0.3, 2);
          job.log(`Processing ${job.data.type} for ${job.data.customerId}`);
          job.log(`Amount: ${job.data.amount} ${job.data.currency}`);
          maybeFail(0.05, errors);
          return {
            transactionId: `txn_${Date.now()}`,
            status: "succeeded",
          };
        }

        if (name === "email-delivery") {
          await sleepRange(0.1, 0.5);
          job.log(`Sending ${job.data.template} to ${job.data.to}`);
          maybeFail(0.02, errors);
          return { messageId: `msg_${Date.now()}`, delivered: true };
        }

        if (name === "image-processing") {
          await sleepRange(1, 8);
          job.log(`Processing ${job.data.operation} on ${job.data.fileName}`);
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
