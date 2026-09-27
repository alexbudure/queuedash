import { TRPCError } from "@trpc/server";

import type { InternalContext } from "../trpc";

// JSON.parse keeps a "__proto__" key as an ordinary own property, but
// assigning it, as zod does when it copies an object's unknown keys and as
// Object.assign does, replaces the target's prototype instead. The values
// then hide from every key check while a queue library still reads them
// through the prototype, so job options carrying one are refused outright.
// Iterative, so no nesting depth can overflow the stack.
export const containsPrototypeKey = (value: unknown): boolean => {
  const pending = [value];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== "object" || current === null) continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Object.hasOwn(current, "__proto__")) return true;
    for (const child of Object.values(current)) pending.push(child);
  }
  return false;
};

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
