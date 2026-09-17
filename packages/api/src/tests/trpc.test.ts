import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { procedure, router } from "../trpc";
import { expectTRPCError } from "./test.utils";

const errorRouter = router({
  rawError: procedure.query(() => {
    throw new Error("access_token=raw-secret");
  }),
  trpcError: procedure.query(() => {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "headers.authorization=Bearer-raw-secret",
    });
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
});
