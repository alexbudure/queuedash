import { describe, expect, it } from "vitest";

import {
  presentErrorMessage,
  presentJob,
  presentLogs,
  presentScheduler,
  redactText,
} from "../presentation";
import type { AdaptedJob, SchedulerInfo } from "../queue-adapters/base.adapter";

const createJob = (): AdaptedJob => ({
  id: "job-1",
  name: "Send receipt",
  data: {
    authorization: "Bearer raw-secret",
    customer: {
      email: "person@example.com",
      password: "hunter2",
    },
  },
  opts: {
    attempts: 3,
  },
  createdAt: new Date("2026-01-01T00:00:00Z"),
  processedAt: null,
  finishedAt: null,
  failedReason: 'request failed with token="raw-secret"',
  stacktrace: ["Error: apiKey=raw-secret"],
  retriedAt: null,
  returnValue: {
    access_token: "raw-secret",
    ok: false,
  },
});

describe("presentation redaction", () => {
  it("redacts built-in sensitive keys across every job payload surface", () => {
    const job = presentJob(createJob(), { redact: true });

    expect(job.data).toEqual({
      authorization: "[REDACTED]",
      customer: {
        email: "person@example.com",
        password: "[REDACTED]",
      },
    });
    expect(job.returnValue).toEqual({
      access_token: "[REDACTED]",
      ok: false,
    });
    expect(job.failedReason).toBe("request failed with token=[REDACTED]");
    expect(job.stacktrace).toEqual(["Error: apiKey=[REDACTED]"]);
    expect(job.createdAt).toEqual(new Date("2026-01-01T00:00:00Z"));
  });

  it("supports custom paths, keys, and replacement values", () => {
    const job = presentJob(createJob(), {
      redact: {
        includeDefaultKeys: false,
        keys: ["email"],
        paths: ["data.customer.password"],
        replacement: "***",
      },
    });

    expect(job.data).toMatchObject({
      authorization: "Bearer raw-secret",
      customer: {
        email: "***",
        password: "***",
      },
    });
  });

  it("redacts logs and scheduler template data", () => {
    const scheduler: SchedulerInfo = {
      key: "daily",
      name: "daily",
      template: {
        data: { token: "raw-secret", visible: "yes" },
      },
    };

    expect(
      presentLogs(["password=hunter2", '{"apiKey":"abc"}'], {
        redact: true,
      }),
    ).toEqual(["password=[REDACTED]", '{"apiKey":"[REDACTED]"}']);
    expect(presentScheduler(scheduler, { redact: true })).toMatchObject({
      template: {
        data: { token: "[REDACTED]", visible: "yes" },
      },
    });
  });

  it("withholds entire response categories before serialization", () => {
    const privacy = {
      expose: {
        jobData: false,
        jobOptions: false,
        returnValues: false,
        stacktraces: false,
        logs: false,
        schedulerData: false,
      },
    };
    const job = presentJob(createJob(), privacy);

    expect(job.data).toEqual({});
    expect(job.opts).toEqual({});
    expect(job.returnValue).toBeUndefined();
    expect(job.stacktrace).toBeUndefined();
    expect(presentLogs(["secret"], privacy)).toBeNull();
    expect(
      presentScheduler(
        {
          key: "daily",
          name: "daily",
          template: { data: { secret: "raw" } },
        },
        privacy,
      ).template?.data,
    ).toBeUndefined();
  });

  it("leaves output untouched when redaction is disabled", () => {
    const job = createJob();
    expect(presentJob(job)).toBe(job);
    expect(redactText("token=visible")).toBe("token=visible");
  });

  it("redacts adapter error messages before they reach tRPC", () => {
    expect(
      presentErrorMessage(new Error("authorization=Bearer-secret"), {
        redact: true,
      }),
    ).toBe("authorization=[REDACTED]");
  });
});
