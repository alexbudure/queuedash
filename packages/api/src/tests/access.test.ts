import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { assertQueueActionAllowed, resolveQueueAccess } from "../access";
import type { InternalContext } from "../trpc";

describe("queue access policy", () => {
  it("applies wildcard rules and read-only mode", () => {
    const access = resolveQueueAccess("payments-production", {
      default: "full",
      rules: [{ queues: ["payments-*"], mode: "read-only" }],
    });

    expect(access.mode).toBe("read-only");
    expect(Object.values(access.actions).every((allowed) => !allowed)).toBe(
      true,
    );
  });

  it("supports action-specific denies without hiding other actions", () => {
    const access = resolveQueueAccess("email", {
      rules: [
        {
          queues: ["email"],
          deny: ["queue.empty", "job.remove"],
        },
      ],
    });

    expect(access.mode).toBe("full");
    expect(access.actions["queue.empty"]).toBe(false);
    expect(access.actions["job.remove"]).toBe(false);
    expect(access.actions["job.retry"]).toBe(true);
    expect(access.actions["scheduler.update"]).toBe(true);
  });

  it("matches pattern characters literally, however often a pattern is used", () => {
    const access = {
      rules: [{ queues: ["billing.(eu)+*"], mode: "hidden" as const }],
    };

    for (let call = 0; call < 3; call++) {
      expect(resolveQueueAccess("billing.(eu)+retries", access).mode).toBe(
        "hidden",
      );
      expect(resolveQueueAccess("billingX(eu)+retries", access).mode).toBe(
        "full",
      );
      expect(resolveQueueAccess("billing.eu+retries", access).mode).toBe(
        "full",
      );
    }
  });

  it("keeps resolving correctly past the compiled-pattern bound", () => {
    const names = Array.from(
      { length: 1_500 },
      (_, index) => `tenant-${index}`,
    );
    const resolveAll = () =>
      names.map(
        (name) =>
          resolveQueueAccess(name, {
            rules: [
              { queues: [`${name}*`], mode: "read-only" },
              { queues: [`${name}-archive`], mode: "hidden" },
            ],
          }).mode,
      );

    // The second pass reads patterns the first one pushed out of the cache.
    expect(resolveAll().every((mode) => mode === "read-only")).toBe(true);
    expect(resolveAll().every((mode) => mode === "read-only")).toBe(true);
    expect(
      resolveQueueAccess("tenant-7-archive", {
        rules: [{ queues: ["tenant-7-archive"], mode: "hidden" }],
      }).mode,
    ).toBe("hidden");
  });

  it("rejects disabled actions at the server boundary", () => {
    const ctx = {
      queues: [
        {
          adapter: {
            getName: () => "critical",
          } as InternalContext["queues"][number]["adapter"],
        },
      ],
      access: {
        rules: [{ queues: ["critical"], mode: "read-only" as const }],
      },
    } satisfies InternalContext;

    expect(() =>
      assertQueueActionAllowed(ctx, "critical", "job.add"),
    ).toThrowError(TRPCError);
  });
});
