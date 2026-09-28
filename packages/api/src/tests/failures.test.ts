import { describe, expect, test } from "vitest";

import { getFailureSignature, maskFailureMessage } from "../failures";
import type { AdaptedJob } from "../queue-adapters/base.adapter";

const failedJob = (overrides: Partial<AdaptedJob>): AdaptedJob => ({
  id: "1",
  name: "send-email",
  data: {},
  opts: {},
  createdAt: new Date(0),
  processedAt: new Date(0),
  finishedAt: new Date(0),
  retriedAt: null,
  ...overrides,
});

describe("maskFailureMessage", () => {
  test.each([
    [
      "Order 48213 not found for user 9f8e7d6c5b4a39281706f5e4",
      "Order ‹num› not found for user ‹id›",
    ],
    [
      "Too many requests for ada@example.com, retry after 30s",
      "Too many requests for ‹email›, retry after ‹num›s",
    ],
    [
      "Job 3f2c9a1e-8b7d-4c6e-9a5f-1d2e3f4a5b6c timed out after 30000ms",
      "Job ‹id› timed out after ‹num›ms",
    ],
    [
      "GET https://api.example.com/v1/orders/42?expand=all failed",
      "GET ‹url› failed",
    ],
    ["Scheduled for 2026-09-28T14:03:11.402Z", "Scheduled for ‹time›"],
  ])("masks what varies between jobs: %s", (input, expected) => {
    expect(maskFailureMessage(input)).toBe(expected);
  });

  test("keeps status codes, which tell failures apart", () => {
    expect(
      maskFailureMessage(
        "421 Service not available, closing transmission channel",
      ),
    ).toBe("421 Service not available, closing transmission channel");
    expect(maskFailureMessage("Request failed with status code 503")).toBe(
      "Request failed with status code 503",
    );
  });

  test("keeps quoted identifiers but masks quoted data", () => {
    expect(
      maskFailureMessage(
        "Cannot read properties of undefined (reading 'email')",
      ),
    ).toBe("Cannot read properties of undefined (reading 'email')");
    expect(maskFailureMessage('"to" must be a valid email')).toBe(
      '"to" must be a valid email',
    );
    expect(maskFailureMessage("Unknown plan 'pro-2024 annual'")).toBe(
      "Unknown plan ‹str›",
    );
  });

  test("reads only the first line", () => {
    expect(maskFailureMessage("Failed\n    at somewhere (x.js:1:1)")).toBe(
      "Failed",
    );
  });
});

describe("getFailureSignature", () => {
  const stack = (message: string, frame: string) =>
    [
      `SmtpError: ${message}`,
      `    at ${frame}`,
      "    at processTicksAndRejections (node:internal/process/task_queues:105:5)",
    ].join("\n");

  test("names the type, masked message and first frame in app code", () => {
    const signature = getFailureSignature(
      failedJob({
        failedReason: "Mailbox 8812 is full",
        stacktrace: [
          [
            "SmtpError: Mailbox 8812 is full",
            "    at SMTPConnection._send (/app/node_modules/nodemailer/lib/smtp.js:12:5)",
            "    at async sendMail (/app/src/mailer/smtp.ts:42:13)",
          ].join("\n"),
        ],
      }),
    );

    expect(signature).toMatchObject({
      type: "SmtpError",
      message: "Mailbox ‹num› is full",
      frame: "src/mailer/smtp.ts › sendMail",
    });
    expect(signature?.fingerprint).toMatch(/^[0-9a-f]{16}$/u);
  });

  test("groups failures that differ only in variable parts", () => {
    const first = getFailureSignature(
      failedJob({
        failedReason: "Order 1 not found",
        stacktrace: [
          stack("Order 1 not found", "load (/app/src/orders.ts:10:3)"),
        ],
      }),
    );
    const second = getFailureSignature(
      failedJob({
        failedReason: "Order 2 not found",
        // Same function and file, different line: a redeploy moved it.
        stacktrace: [
          stack("Order 2 not found", "load (/app/src/orders.ts:14:3)"),
        ],
      }),
    );
    const elsewhere = getFailureSignature(
      failedJob({
        failedReason: "Order 3 not found",
        stacktrace: [
          stack("Order 3 not found", "load (/app/src/refunds.ts:10:3)"),
        ],
      }),
    );

    expect(second?.fingerprint).toBe(first?.fingerprint);
    expect(elsewhere?.fingerprint).not.toBe(first?.fingerprint);
  });

  test("uses the stack of the attempt the reason describes", () => {
    const signature = getFailureSignature(
      failedJob({
        failedReason: "Second failure",
        stacktrace: [
          stack("First failure", "first (/app/src/a.ts:1:1)"),
          stack("Second failure", "second (/app/src/b.ts:1:1)"),
        ],
      }),
    );

    expect(signature?.frame).toBe("app/src/b.ts › second");
  });

  test("reads the type from the reason when traces are hidden", () => {
    const signature = getFailureSignature(
      failedJob({ failedReason: "TypeError: x is not a function" }),
    );

    expect(signature).toMatchObject({
      type: "TypeError",
      message: "x is not a function",
      frame: null,
    });
  });

  test("returns null for a job with no failure", () => {
    expect(getFailureSignature(failedJob({}))).toBeNull();
  });
});
