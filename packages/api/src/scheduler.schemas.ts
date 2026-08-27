import { z } from "zod";

const schedulerTemplateOptionsSchema = z
  .object({
    attempts: z.unknown().optional(),
    backoff: z.unknown().optional(),
    continueParentOnFailure: z.boolean().optional(),
    failParentOnFailure: z.boolean().optional(),
    ignoreDependencyOnFailure: z.boolean().optional(),
    keepLogs: z.unknown().optional(),
    lifo: z.unknown().optional(),
    priority: z.unknown().optional(),
    removeDependencyOnFailure: z.boolean().optional(),
    removeOnComplete: z.unknown().optional(),
    removeOnFail: z.unknown().optional(),
    sizeLimit: z.unknown().optional(),
    stackTraceLimit: z.unknown().optional(),
    telemetry: z
      .object({
        metadata: z.string().optional(),
        omitContext: z.boolean().optional(),
      })
      .strict()
      .optional(),
    timestamp: z.number().finite().optional(),
  })
  .strict();

const schedulerDateSchema = z.union([
  z.number().finite(),
  z.string().trim().min(1),
  z.date(),
]);

export const schedulerTemplateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    data: z.record(z.string(), z.unknown()),
    opts: schedulerTemplateOptionsSchema.optional(),
  })
  .strict();

export const schedulerOptionsSchema = z
  .object({
    pattern: z.string().trim().min(1).optional(),
    every: z.number().finite().positive().optional(),
    tz: z.string().trim().min(1).optional(),
    limit: z.number().int().positive().optional(),
    startDate: schedulerDateSchema.optional(),
    endDate: schedulerDateSchema.optional(),
    offset: z.number().finite().optional(),
    immediately: z.boolean().optional(),
  })
  .strict()
  .refine(
    (opts) => (opts.pattern === undefined) !== (opts.every === undefined),
    {
      message: "You must provide exactly one of `pattern` or `every`",
    },
  );
