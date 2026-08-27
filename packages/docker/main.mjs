import { readFileSync } from "node:fs";

import { createQueuedashExpressMiddleware } from "@queuedash/api";
import BeeQueue from "bee-queue";
import Bull from "bull";
import { Queue as BullMQQueue } from "bullmq";
import express from "express";
import { Cluster } from "ioredis";
import { z } from "zod";

const queueConfigSchema = z.object({
  ui: z
    .object({
      instanceId: z.string().min(1).optional(),
      branding: z
        .object({
          name: z.string().min(1).optional(),
          logoUrl: z.string().min(1).optional(),
          logoAlt: z.string().min(1).optional(),
        })
        .optional(),
      defaults: z
        .object({
          theme: z.enum(["light", "dark", "system"]).optional(),
          refreshIntervalMs: z
            .union([z.number().int().min(1000).max(60000), z.literal(false)])
            .optional(),
          jobsPerPage: z
            .union([
              z.literal(20),
              z.literal(30),
              z.literal(50),
              z.literal(100),
            ])
            .optional(),
          defaultJobStatus: z
            .enum([
              "remember",
              "completed",
              "failed",
              "delayed",
              "active",
              "prioritized",
              "waiting",
              "waiting-children",
              "paused",
            ])
            .optional(),
          density: z.enum(["compact", "comfortable"]).optional(),
          timestamps: z.enum(["relative", "absolute"]).optional(),
          showOverviewMetrics: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  privacy: z
    .object({
      redact: z
        .union([
          z.boolean(),
          z.object({
            includeDefaultKeys: z.boolean().optional(),
            keys: z.array(z.string().min(1)).optional(),
            paths: z.array(z.string().min(1)).optional(),
            replacement: z.string().optional(),
          }),
        ])
        .optional(),
      expose: z
        .object({
          jobData: z.boolean().optional(),
          jobOptions: z.boolean().optional(),
          returnValues: z.boolean().optional(),
          stacktraces: z.boolean().optional(),
          logs: z.boolean().optional(),
          schedulerData: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  access: z
    .object({
      default: z.enum(["full", "read-only", "hidden"]).optional(),
      rules: z
        .array(
          z.object({
            queues: z.array(z.string().min(1)).min(1),
            mode: z.enum(["full", "read-only", "hidden"]).optional(),
            deny: z
              .array(
                z.enum([
                  "queue.pause",
                  "queue.resume",
                  "queue.empty",
                  "queue.clean",
                  "job.add",
                  "job.retry",
                  "job.promote",
                  "job.discard",
                  "job.rerun",
                  "job.remove",
                  "scheduler.add",
                  "scheduler.update",
                  "scheduler.remove",
                ]),
              )
              .optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  search: z
    .object({
      maxScanned: z.number().int().min(25).max(5000).optional(),
    })
    .optional(),
  discovery: z
    .object({
      type: z.enum(["bull", "bullmq"]),
      connectionUrl: z.string().min(1),
      prefix: z.string().min(1).optional(),
      refreshIntervalMs: z.number().int().min(5000).optional(),
      maxQueues: z.number().int().min(1).max(1000).optional(),
    })
    .optional(),
  queues: z
    .array(
      z
        .object({
          name: z.string(),
          displayName: z.string(),
          type: z.enum(["bull", "bullmq", "bee"]),
          connectionUrl: z.string().optional(),
          clusterNodes: z
            .array(z.object({ host: z.string(), port: z.number() }))
            .optional(),
          prefix: z.string().optional(),
        })
        .refine(
          (data) => data.connectionUrl || data.clusterNodes,
          "Either connectionUrl or clusterNodes must be provided",
        )
        .refine(
          (data) => !(data.connectionUrl && data.clusterNodes),
          "Cannot specify both connectionUrl and clusterNodes",
        ),
    )
    .default([]),
});

const getConfigJson = () => {
  if (process.env.QUEUES_CONFIG_JSON) {
    return process.env.QUEUES_CONFIG_JSON;
  }

  if (process.env.QUEUES_CONFIG_FILE_PATH) {
    return readFileSync(process.env.QUEUES_CONFIG_FILE_PATH, "utf-8");
  }

  throw new Error(
    "Either QUEUES_CONFIG_JSON or QUEUES_CONFIG_FILE_PATH environment variables must be set",
  );
};

const getQueuesFromConfig = (config) => {
  return config.queues.map((queueConfig) => {
    if (queueConfig.clusterNodes) {
      if (queueConfig.type !== "bullmq") {
        throw new Error(
          `Cluster mode is only supported for bullmq queues, but queue "${queueConfig.name}" has type "${queueConfig.type}"`,
        );
      }

      const queue = new BullMQQueue(queueConfig.name, {
        connection: new Cluster(queueConfig.clusterNodes),
        ...(queueConfig.prefix !== undefined && {
          prefix: queueConfig.prefix,
        }),
      });
      return {
        queue,
        displayName: queueConfig.displayName,
        type: "bullmq",
      };
    }

    if (!queueConfig.connectionUrl) {
      throw new Error(
        `Queue "${queueConfig.name}" is missing connectionUrl and clusterNodes`,
      );
    }

    // Check if connection URL uses TLS (rediss://)
    const usesTls = queueConfig.connectionUrl.startsWith("rediss://");

    if (queueConfig.type === "bullmq") {
      const queue = new BullMQQueue(queueConfig.name, {
        connection: {
          url: queueConfig.connectionUrl,
          ...(usesTls && { tls: {} }),
        },
        ...(queueConfig.prefix !== undefined && {
          prefix: queueConfig.prefix,
        }),
      });
      return {
        queue,
        displayName: queueConfig.displayName,
        type: "bullmq",
      };
    } else if (queueConfig.type === "bull") {
      const queue = new Bull(queueConfig.name, queueConfig.connectionUrl, {
        ...(queueConfig.prefix !== undefined && {
          prefix: queueConfig.prefix,
        }),
        redis: {
          ...(usesTls && { tls: {} }),
        },
      });
      return {
        queue,
        displayName: queueConfig.displayName,
        type: "bull",
      };
    } else {
      const queue = new BeeQueue(queueConfig.name, {
        ...(queueConfig.prefix !== undefined && {
          prefix: queueConfig.prefix,
        }),
        redis: queueConfig.connectionUrl,
        ...(usesTls && { tls: {} }),
      });
      return {
        queue,
        displayName: queueConfig.displayName,
        type: "bee",
      };
    }
  });
};

const getAuthFromEnvironment = () => {
  const username = process.env.QUEUEDASH_AUTH_USERNAME;
  const password = process.env.QUEUEDASH_AUTH_PASSWORD;
  const mode = process.env.QUEUEDASH_AUTH_MODE;
  const sessionSecret = process.env.QUEUEDASH_AUTH_SESSION_SECRET;
  const ttlSeconds = process.env.QUEUEDASH_AUTH_SESSION_TTL_SECONDS;
  const secure = process.env.QUEUEDASH_AUTH_COOKIE_SECURE;

  if (
    username === undefined &&
    password === undefined &&
    mode === undefined &&
    sessionSecret === undefined &&
    ttlSeconds === undefined &&
    secure === undefined
  ) {
    return undefined;
  }

  if (!username || !password) {
    throw new Error(
      "QUEUEDASH_AUTH_USERNAME and QUEUEDASH_AUTH_PASSWORD must both be set to non-empty values",
    );
  }

  if (mode !== undefined && mode !== "session" && mode !== "basic") {
    throw new Error('QUEUEDASH_AUTH_MODE must be either "session" or "basic"');
  }

  if (sessionSecret !== undefined && !sessionSecret) {
    throw new Error("QUEUEDASH_AUTH_SESSION_SECRET must not be empty");
  }

  const parsedTtlSeconds =
    ttlSeconds === undefined ? undefined : Number(ttlSeconds);
  if (
    parsedTtlSeconds !== undefined &&
    (!Number.isInteger(parsedTtlSeconds) ||
      parsedTtlSeconds < 60 ||
      parsedTtlSeconds > 30 * 24 * 60 * 60)
  ) {
    throw new Error(
      "QUEUEDASH_AUTH_SESSION_TTL_SECONDS must be an integer between 60 and 2592000",
    );
  }

  if (secure !== undefined && secure !== "true" && secure !== "false") {
    throw new Error(
      'QUEUEDASH_AUTH_COOKIE_SECURE must be either "true" or "false"',
    );
  }

  return {
    username,
    password,
    ...(mode ? { mode } : {}),
    ...((sessionSecret !== undefined ||
      parsedTtlSeconds !== undefined ||
      secure !== undefined) && {
      session: {
        ...(sessionSecret !== undefined && { secret: sessionSecret }),
        ...(parsedTtlSeconds !== undefined && {
          ttlSeconds: parsedTtlSeconds,
        }),
        ...(secure !== undefined && { secure: secure === "true" }),
      },
    }),
  };
};

const getTrustProxyFromEnvironment = () => {
  const value = process.env.QUEUEDASH_TRUST_PROXY;
  if (value === undefined || value === "false") return false;
  if (value === "true") return 1;

  const hops = Number(value);
  if (!Number.isInteger(hops) || hops < 1 || hops > 10) {
    throw new Error(
      'QUEUEDASH_TRUST_PROXY must be "true", "false", or an integer from 1 to 10',
    );
  }
  return hops;
};

const app = express();
const config = queueConfigSchema.parse(JSON.parse(getConfigJson()));
const trustProxy = getTrustProxyFromEnvironment();
if (trustProxy !== false) app.set("trust proxy", trustProxy);

app.use(
  "/",
  createQueuedashExpressMiddleware({
    auth: getAuthFromEnvironment(),
    ctx: {
      queues: getQueuesFromConfig(config),
      discovery: config.discovery,
      privacy: config.privacy,
      access: config.access,
      search: config.search,
      ui: config.ui,
    },
  }),
);

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`🚀 Server listening on http://${HOST}:${PORT}`);
});
