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
