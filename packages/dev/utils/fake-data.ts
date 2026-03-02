import Bull from "bull";
import type { JobsOptions as BullMQJobOptions, RepeatOptions } from "bullmq";
import { Queue as BullMQQueue } from "bullmq";
import { Queue as GroupMQQueue } from "groupmq";
import BeeQueue from "bee-queue";
import { faker } from "@faker-js/faker";
import Redis from "ioredis";

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
      flows: {
        name: string;
        data: Record<string, unknown>;
        children: {
          name: string;
          data: Record<string, unknown>;
        }[];
      }[];
      jobName: (job: Record<string, unknown>) => string;
      schedulers: {
        name: string;
        opts: RepeatOptions;
        template: {
          name?: string | undefined;
          data?: Record<string, unknown>;
          opts?: Omit<
            BullMQJobOptions,
            "jobId" | "repeat" | "delay" | "deduplication" | "debounce"
          >;
        };
      }[];
    }
  | {
      queue: GroupMQQueue;
      type: "groupmq";
      displayName: string;
      jobs: {
        groupId: string;
        data: Record<string, unknown>;
        delay?: number;
      }[];
      jobName: (job: Record<string, unknown>) => string;
    }
  | {
      queue: BeeQueue;
      type: "bee";
      displayName: string;
      jobs: { data: Record<string, unknown> }[];
      jobName: (job: Record<string, unknown>) => string;
    };

// --- Helpers ---

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;
const head = (value: unknown, length: number, fallback: string): string =>
  asString(value)?.slice(0, length) ?? fallback;
const tail = (value: unknown, length: number, fallback: string): string =>
  asString(value)?.slice(-length) ?? fallback;
const emailUser = (value: unknown, fallback: string): string => {
  const str = asString(value);
  if (!str) return fallback;
  return str.split("@")[0] || fallback;
};
const hostFromUrl = (value: unknown, fallback: string): string => {
  const str = asString(value);
  if (!str) return fallback;
  return str.replace(/https?:\/\//, "").split("/")[0] || fallback;
};

const PAYMENT_METHODS = ["visa", "mastercard", "amex", "paypal", "apple_pay"];
const CURRENCIES = ["usd", "eur", "gbp"];

const EMAIL_TEMPLATES = [
  "welcome",
  "password-reset",
  "order-confirmation",
  "invoice",
  "shipping-update",
  "review-request",
  "weekly-digest",
];

const REPORT_TYPES = [
  "monthly-revenue",
  "weekly-active-users",
  "inventory-snapshot",
  "churn-analysis",
  "conversion-funnel",
  "support-tickets",
];

const IMAGE_OPS = [
  "resize",
  "thumbnail",
  "compress",
  "watermark",
  "convert-webp",
  "crop-face",
];

const WEBHOOK_EVENTS = [
  "order.created",
  "order.shipped",
  "payment.completed",
  "payment.failed",
  "user.signup",
  "user.updated",
  "subscription.renewed",
  "refund.processed",
  "invoice.paid",
];

const DOC_TYPES = ["product", "user", "order", "article", "category"];
const INDEX_ACTIONS = ["index", "update", "delete", "reindex"];

// --- Queues ---

export const queues: FakeQueue[] = [
  // ─── 1. Payment Processing (BullMQ) ──────────────────────────
  {
    queue: new BullMQQueue("payment-processing"),
    type: "bullmq" as const,
    displayName: "Payment processing",
    jobs: [...new Array(180)].map((_, i) => {
      const isRefund = i % 12 === 0;
      const isPayout = i % 25 === 0;
      const type = isPayout ? "payout" : isRefund ? "refund" : "charge";
      const customerId = `cus_${faker.string.alphanumeric(14)}`;
      return {
        data: {
          type,
          amount: faker.number.float({
            min: type === "payout" ? 500 : 5,
            max: type === "payout" ? 25000 : 2500,
            fractionDigits: 2,
          }),
          currency: pick(CURRENCIES),
          customerId,
          customerEmail: faker.internet.email(),
          paymentMethod: pick(PAYMENT_METHODS),
          description: isRefund
            ? `Refund for order ${faker.string.alphanumeric(8).toUpperCase()}`
            : isPayout
              ? "Monthly payout"
              : faker.commerce.productName(),
          metadata: {
            orderId: `ord_${faker.string.alphanumeric(12)}`,
            ip: faker.internet.ip(),
          },
        },
        opts: {
          priority: isRefund
            ? 1
            : isPayout
              ? 2
              : faker.number.int({ min: 3, max: 5 }),
          attempts: 3,
          backoff: { type: "exponential" as const, delay: 2000 },
          ...(i % 30 === 0
            ? { delay: faker.number.int({ min: 60000, max: 3600000 }) }
            : {}),
        },
      };
    }),
    schedulers: [
      {
        name: "recurring-billing-check",
        opts: { pattern: "0 */6 * * *", tz: "America/New_York" },
        template: {
          name: "billing-check",
          data: { type: "recurring-billing-scan" },
          opts: { priority: 2 },
        },
      },
      {
        name: "daily-settlement",
        opts: { pattern: "0 2 * * *", tz: "America/New_York" },
        template: {
          name: "settlement",
          data: { type: "daily-settlement" },
          opts: { priority: 1 },
        },
      },
      {
        name: "fraud-scan",
        opts: { pattern: "*/15 * * * *", tz: "UTC" },
        template: {
          name: "fraud-detection",
          data: { type: "fraud-scan", threshold: 0.85 },
        },
      },
    ],
    flows: [...new Array(4)].map(() => {
      const orderId = `ord_${faker.string.alphanumeric(12)}`;
      const customer = faker.person.fullName();
      return {
        name: `process-order-${orderId}`,
        data: { orderId, customer, step: "charge" },
        children: [
          {
            name: `send-receipt-${orderId}`,
            data: { orderId, email: faker.internet.email(), step: "receipt" },
          },
          {
            name: `update-ledger-${orderId}`,
            data: { orderId, step: "ledger-update" },
          },
        ],
      };
    }),
    jobName: (job) => {
      const type = asString(job.type) ?? "payment";
      const id = head(job.customerId, 12, "unknown");
      return `${type}_${id}`;
    },
  },

  // ─── 2. Email Delivery (BullMQ) ──────────────────────────────
  {
    queue: new BullMQQueue("email-delivery"),
    type: "bullmq" as const,
    displayName: "Email delivery",
    jobs: [...new Array(140)].map((_, i) => {
      const template = pick(EMAIL_TEMPLATES);
      const subjects: Record<string, string> = {
        welcome: "Welcome to our platform!",
        "password-reset": "Reset your password",
        "order-confirmation": `Order #${faker.string.alphanumeric(8).toUpperCase()} confirmed`,
        invoice: `Invoice #INV-${faker.number.int({ min: 10000, max: 99999 })}`,
        "shipping-update": "Your order has shipped",
        "review-request": "How was your experience?",
        "weekly-digest": "This week's highlights",
      };
      return {
        data: {
          to: faker.internet.email(),
          subject: subjects[template] || template,
          template,
          metadata: {
            userId: `usr_${faker.string.alphanumeric(10)}`,
          },
        },
        opts: {
          priority:
            template === "password-reset" ? 1 : template === "welcome" ? 2 : 3,
          attempts: 2,
          backoff: { type: "fixed" as const, delay: 5000 },
          ...(template === "weekly-digest" && i % 3 === 0
            ? { delay: faker.number.int({ min: 0, max: 300000 }) }
            : {}),
        },
      };
    }),
    schedulers: [
      {
        name: "weekly-digest-batch",
        opts: { pattern: "0 9 * * 1", tz: "America/Los_Angeles" },
        template: {
          name: "weekly-digest",
          data: { template: "weekly-digest", batch: true },
        },
      },
    ],
    flows: [],
    jobName: (job) => {
      const template = asString(job.template) ?? "email";
      const to = emailUser(job.to, "unknown");
      return `${template} → ${to}`;
    },
  },

  // ─── 3. Order Fulfillment (Bull) ─────────────────────────────
  {
    queue: new Bull("order-fulfillment"),
    type: "bull" as const,
    displayName: "Order fulfillment",
    jobs: [...new Array(95)].map((_, i) => {
      const orderId = `ORD-${faker.string.alphanumeric(8).toUpperCase()}`;
      const itemCount = faker.number.int({ min: 1, max: 5 });
      return {
        data: {
          orderId,
          items: [...new Array(itemCount)].map(() => ({
            sku: `SKU-${faker.string.alphanumeric(6).toUpperCase()}`,
            name: faker.commerce.productName(),
            qty: faker.number.int({ min: 1, max: 4 }),
            price: faker.number.float({
              min: 9.99,
              max: 499.99,
              fractionDigits: 2,
            }),
          })),
          shipping: {
            name: faker.person.fullName(),
            city: faker.location.city(),
            state: faker.location.state({ abbreviated: true }),
            country: "US",
          },
          total: faker.number.float({
            min: 19.99,
            max: 2500,
            fractionDigits: 2,
          }),
          method: pick(["standard", "express", "overnight"]),
        },
        opts: {
          priority: i % 8 === 0 ? 1 : i % 4 === 0 ? 2 : 3,
          attempts: 2,
          backoff: { type: "fixed" as const, delay: 10000 },
          removeOnComplete: true,
          ...(i % 15 === 0
            ? { delay: faker.number.int({ min: 300000, max: 7200000 }) }
            : {}),
        },
      };
    }),
    jobName: (job) => `fulfill ${asString(job.orderId) ?? "order"}`,
  },

  // ─── 4. Image Processing (BullMQ) ───────────────────────────
  {
    queue: new BullMQQueue("image-processing"),
    type: "bullmq" as const,
    displayName: "Image processing",
    jobs: [...new Array(75)].map(() => {
      const operation = pick(IMAGE_OPS);
      const ext = pick(["jpg", "png", "webp", "heic"]);
      return {
        data: {
          fileId: `file_${faker.string.alphanumeric(16)}`,
          fileName: faker.system.commonFileName(ext),
          operation,
          inputFormat: ext,
          outputFormat: operation === "convert-webp" ? "webp" : ext,
          dimensions: {
            width:
              operation === "thumbnail"
                ? 150
                : faker.number.int({ min: 400, max: 4096 }),
            height:
              operation === "thumbnail"
                ? 150
                : faker.number.int({ min: 400, max: 4096 }),
          },
          quality: faker.number.int({ min: 60, max: 95 }),
          fileSize: faker.number.int({ min: 50000, max: 15000000 }),
          userId: `usr_${faker.string.alphanumeric(10)}`,
        },
        opts: {
          priority: operation === "thumbnail" ? 1 : 3,
          attempts: 2,
          backoff: { type: "fixed" as const, delay: 3000 },
          timeout: 60000,
        },
      };
    }),
    schedulers: [],
    flows: [],
    jobName: (job) =>
      `${asString(job.operation) ?? "process"} ${head(job.fileName, 24, "file")}`,
  },

  // ─── 5. Webhook Delivery (GroupMQ) ───────────────────────────
  {
    queue: new GroupMQQueue({
      redis: new Redis(),
      namespace: "webhook-delivery",
      keepCompleted: 200,
      keepFailed: 200,
    }),
    type: "groupmq" as const,
    displayName: "Webhook delivery",
    jobs: [...new Array(110)].map(() => {
      const endpoints = [
        "https://api.acme.com/webhooks",
        "https://hooks.stripe.com/events",
        "https://app.example.io/hooks",
        "https://notify.partner.dev/v1",
        "https://integrations.client.co/wh",
        "https://api.shopify.com/webhooks",
        "https://hooks.zapier.com/catch",
        "https://webhook.site/demo",
      ];
      const url = pick(endpoints);
      const event = pick(WEBHOOK_EVENTS);
      return {
        groupId: url.replace(/https?:\/\//, "").split("/")[0],
        data: {
          url,
          event,
          payload: {
            id: `evt_${faker.string.alphanumeric(16)}`,
            type: event,
            created: Date.now(),
            data: {
              objectId: `${event.split(".")[0]}_${faker.string.alphanumeric(12)}`,
            },
          },
        },
      };
    }),
    jobName: (job) =>
      `${asString(job.event) ?? "event"} → ${hostFromUrl(job.url, "unknown-host")}`,
  },

  // ─── 6. Report Generation (Bull) ─────────────────────────────
  {
    queue: new Bull("report-generation"),
    type: "bull" as const,
    displayName: "Report generation",
    jobs: [...new Array(28)].map((_, i) => {
      const reportType = pick(REPORT_TYPES);
      const format = pick(["pdf", "csv", "xlsx"]);
      return {
        data: {
          reportType,
          reportId: `rpt_${faker.string.alphanumeric(12)}`,
          dateRange: {
            start: faker.date.recent({ days: 30 }).toISOString(),
            end: new Date().toISOString(),
          },
          format,
          requestedBy: faker.internet.email(),
          filters: {
            region: pick(["us-east", "us-west", "eu", "apac"]),
          },
        },
        opts: {
          priority: i === 0 ? 1 : 3,
          attempts: 2,
          timeout: 120000,
          ...(i % 5 === 0
            ? { delay: faker.number.int({ min: 600000, max: 14400000 }) }
            : {}),
        },
      };
    }),
    jobName: (job) => {
      const type = (asString(job.reportType) ?? "report").replace(/-/g, " ");
      const fmt = (asString(job.format) ?? "n/a").toUpperCase();
      return `${type} (${fmt})`;
    },
  },

  // ─── 7. Search Indexing (BullMQ) ─────────────────────────────
  {
    queue: new BullMQQueue("search-indexing"),
    type: "bullmq" as const,
    displayName: "Search indexing",
    jobs: [...new Array(220)].map(() => {
      const docType = pick(DOC_TYPES);
      const action = pick(INDEX_ACTIONS);
      return {
        data: {
          documentId: `${docType}_${faker.string.alphanumeric(12)}`,
          documentType: docType,
          action,
          index: `${docType}s`,
          version: faker.number.int({ min: 1, max: 50 }),
          ...(action !== "delete"
            ? {
                fields: {
                  title: faker.commerce.productName(),
                  description: faker.lorem.sentence(),
                },
              }
            : {}),
        },
        opts: {
          priority: action === "delete" ? 1 : action === "reindex" ? 2 : 4,
        },
      };
    }),
    schedulers: [
      {
        name: "full-reindex",
        opts: { pattern: "0 3 * * 0", tz: "UTC" },
        template: {
          name: "full-reindex",
          data: { action: "reindex", scope: "all" },
          opts: { priority: 1 },
        },
      },
    ],
    flows: [],
    jobName: (job) =>
      `${asString(job.action) ?? "index"} ${asString(job.documentType) ?? "doc"}/${tail(job.documentId, 8, "unknown")}`,
  },

  // ─── 8. Session Cleanup (BeeQueue) ───────────────────────────
  {
    queue: new BeeQueue("session-cleanup"),
    type: "bee" as const,
    displayName: "Session cleanup",
    jobs: [...new Array(45)].map(() => {
      return {
        data: {
          userId: `usr_${faker.string.alphanumeric(10)}`,
          sessionId: `sess_${faker.string.alphanumeric(24)}`,
          reason: pick(["expired", "idle", "forced-logout", "security"]),
          lastActivity: faker.date.recent({ days: 7 }).toISOString(),
          device: {
            browser: pick(["Chrome", "Firefox", "Safari", "Edge"]),
            os: pick(["macOS", "Windows", "iOS", "Android"]),
          },
        },
      };
    }),
    jobName: (job) => `cleanup ${head(job.sessionId, 16, "session")}`,
  },
];
