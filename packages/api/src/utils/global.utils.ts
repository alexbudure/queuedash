import { TRPCError } from "@trpc/server";
import type { InternalContext } from "../trpc";

export const findQueueInCtxOrFail = ({
  queueName,
  queues,
}: {
  queueName: string;
  queues: InternalContext["queues"];
}) => {
  const queueInCtx = queues.find((q) => q.adapter.getName() === queueName);
  if (!queueInCtx) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Queue "${queueName}" not found`,
    });
  }
  return queueInCtx;
};
