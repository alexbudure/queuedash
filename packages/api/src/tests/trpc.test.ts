import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import {
  JobNotFoundError,
  UnsupportedSchedulerUpdateError,
} from "../queue-adapters/base.adapter";
import {
  type Context,
  procedure,
  type QueuedashAccessRule,
  router,
  transformContext,
} from "../trpc";
import { expectTRPCError } from "./test.utils";

// What an adapter throws; kept so a test can assert the same instance arrives
// as the cause.
const adapterFailure = new Error("access_token=raw-secret");
const missingJob = new JobNotFoundError();
const legacySchedulerUpdate = new UnsupportedSchedulerUpdateError(
  "Legacy repeatable jobs cannot be updated",
);

const errorRouter = router({
  rawError: procedure.query(() => {
    throw adapterFailure;
  }),
  trpcError: procedure.query(() => {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "headers.authorization=Bearer-raw-secret",
    });
  }),
  missingJob: procedure.mutation(async () => {
    throw missingJob;
  }),
  legacySchedulerUpdate: procedure.mutation(async () => {
    throw legacySchedulerUpdate;
  }),
});

describe("tRPC error presentation", () => {
  it("redacts uncaught resolver errors", async () => {
    const caller = errorRouter.createCaller({
      privacy: { redact: true },
    });

    const error = await expectTRPCError(
      () => caller.rawError(),
      "INTERNAL_SERVER_ERROR",
    );
    expect(error.message).toBe("access_token=[REDACTED]");
  });

  it("preserves tRPC error codes while redacting their messages", async () => {
    const caller = errorRouter.createCaller({
      privacy: { redact: true },
    });

    const error = await expectTRPCError(
      () => caller.trpcError(),
      "BAD_REQUEST",
    );
    expect(error.message).toBe("headers.authorization=[REDACTED]");
  });

  it("gives a host's onError the adapter's own error as the cause", async () => {
    const reported: TRPCError[] = [];
    const caller = errorRouter.createCaller(
      { privacy: { redact: true } },
      { onError: ({ error }) => void reported.push(error) },
    );

    const error = await expectTRPCError(
      () => caller.rawError(),
      "INTERNAL_SERVER_ERROR",
    );
    expect(error.message).toBe("access_token=[REDACTED]");
    expect(error.cause).toBe(adapterFailure);
    // The stack is serialized in development, so it must not carry the
    // unredacted message the cause still has.
    expect(error.stack).not.toContain("raw-secret");
    expect(reported).toHaveLength(1);
    expect(reported[0]?.message).toBe("access_token=[REDACTED]");
    expect(reported[0]?.cause).toBe(adapterFailure);
  });

  it("answers an adapter's missing job with NOT_FOUND", async () => {
    const caller = errorRouter.createCaller({});

    const error = await expectTRPCError(() => caller.missingJob(), "NOT_FOUND");
    expect(error.message).toBe("Job not found");
    expect(error.cause).toBe(missingJob);
  });

  it("answers an unsupported scheduler update with BAD_REQUEST", async () => {
    const caller = errorRouter.createCaller({});

    const error = await expectTRPCError(
      () => caller.legacySchedulerUpdate(),
      "BAD_REQUEST",
    );
    expect(error.message).toBe("Legacy repeatable jobs cannot be updated");
    expect(error.cause).toBe(legacySchedulerUpdate);
  });
});

describe("visible queues", () => {
  // Enough for an adapter; nothing here reaches Redis.
  const beeQueue = (name: string) =>
    ({
      queue: { name, settings: {}, checkHealth() {} },
      displayName: name,
      type: "bee",
    }) as unknown as NonNullable<Context["queues"]>[number];

  // Counts access resolutions: each one asks a rule whether it matches.
  class CountedPatterns extends Array<string> {
    static checks = 0;
    some(...args: Parameters<string[]["some"]>): boolean {
      CountedPatterns.checks += 1;
      return super.some(...args);
    }
  }

  const visibleNames = async (ctx: Context) =>
    (await transformContext(ctx)).queues.map(({ adapter }) =>
      adapter.getName(),
    );

  it("are resolved once until the queues or the access policy change", async () => {
    const rules: QueuedashAccessRule[] = [
      { queues: CountedPatterns.from(["internal-*"]), mode: "hidden" },
    ];
    const ctx: Context = {
      queues: [
        ...Array.from({ length: 50 }, (_, index) => beeQueue(`queue-${index}`)),
        beeQueue("internal-audit"),
      ],
      access: { rules },
    };

    CountedPatterns.checks = 0;
    for (let poll = 0; poll < 10; poll++) {
      expect(await visibleNames(ctx)).toHaveLength(50);
    }
    expect(CountedPatterns.checks).toBe(51);

    // An access config edited in place takes effect on the next call.
    rules.push({ queues: ["queue-7"], mode: "hidden" });
    expect(await visibleNames(ctx)).not.toContain("queue-7");
    expect(await visibleNames(ctx)).toHaveLength(49);

    // So does a queue the host adds.
    ctx.queues = [...(ctx.queues ?? []), beeQueue("queue-new")];
    expect(await visibleNames(ctx)).toContain("queue-new");
    expect(CountedPatterns.checks).toBe(51 * 2 + 52);
  });
});
