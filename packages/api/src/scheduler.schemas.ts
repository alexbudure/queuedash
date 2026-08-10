import { z } from "zod";

export const schedulerTemplateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  data: z.record(z.string(), z.unknown()),
  opts: z.record(z.string(), z.unknown()).optional(),
});

export const schedulerOptionsSchema = z
  .object({
    pattern: z.string().trim().min(1).optional(),
    every: z.number().positive().optional(),
    tz: z.string().trim().min(1).optional(),
  })
  .passthrough()
  .refine((opts) => Boolean(opts.pattern || opts.every), {
    message: "You must provide either `pattern` or `every`",
  });
