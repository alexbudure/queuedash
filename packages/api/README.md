# `@queuedash/api`

Server adapters, queue integrations, discovery, privacy controls, and access
enforcement for the beautiful Queuedash dashboard.

[![NPM version](https://img.shields.io/npm/v/@queuedash/api.svg?style=flat-square)](https://www.npmjs.com/package/@queuedash/api)
[![MIT license](https://img.shields.io/npm/l/@queuedash/api.svg?style=flat-square)](https://github.com/alexbudure/queuedash/blob/main/LICENSE)

## Install

Install `@queuedash/api` alongside your existing queue and web framework:

```bash
npm install @queuedash/api
```

Bull, BullMQ, Bee-Queue, GroupMQ, Express, Fastify, Hono, and Elysia are
optional peer dependencies. Install only the libraries used by your
application.

## Express quick start

```typescript
import { createQueuedashExpressMiddleware } from "@queuedash/api";
import Bull from "bull";
import express from "express";

const app = express();
const reports = new Bull("reports");

app.use(
  "/queuedash",
  createQueuedashExpressMiddleware({
    ctx: {
      queues: [
        {
          queue: reports,
          displayName: "Reports",
          type: "bull",
        },
      ],
    },
  }),
);

app.listen(3000);
```

The Express mount path becomes the UI base path. The middleware serves its tRPC
API beneath `/queuedash/trpc`.

## Server integrations

| Runtime               | Export                                      | Example                                                                                  |
| --------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Express               | `createQueuedashExpressMiddleware({ ctx })` | [Source](https://github.com/alexbudure/queuedash/tree/main/examples/with-express)        |
| Fastify               | `fastifyQueuedashPlugin`                    | [Source](https://github.com/alexbudure/queuedash/tree/main/examples/with-fastify)        |
| Hono                  | `createHonoAdapter({ baseUrl, ctx })`       | [Source](https://github.com/alexbudure/queuedash/tree/main/examples/with-hono)           |
| Elysia / Bun          | `queuedash({ baseUrl, ctx })`               | [Source](https://github.com/alexbudure/queuedash/tree/main/examples/with-elysia-and-bun) |
| Next.js / custom tRPC | `appRouter`                                 | [Source](https://github.com/alexbudure/queuedash/tree/main/examples/with-next)           |

Fastify is registered as a plugin:

```typescript
import { fastifyQueuedashPlugin } from "@queuedash/api";

server.register(fastifyQueuedashPlugin, {
  baseUrl: "/queuedash",
  ctx,
});
```

Hono mounts a child application:

```typescript
import { createHonoAdapter } from "@queuedash/api";

app.route(
  "/queuedash",
  createHonoAdapter({
    baseUrl: "/queuedash",
    ctx,
  }),
);
```

Elysia uses the `queuedash` plugin:

```typescript
import { queuedash } from "@queuedash/api";

const app = new Elysia().use(
  queuedash({
    baseUrl: "/queuedash",
    ctx,
  }),
);
```

For Next.js or another tRPC-compatible runtime, mount the exported `appRouter`
and render [`@queuedash/ui`](https://www.npmjs.com/package/@queuedash/ui)
separately.

## Authentication

The Express, Fastify, Hono, and Elysia adapters accept the same optional
`auth` configuration:

```typescript
import type { QueuedashAuthOptions } from "@queuedash/api";

const auth = {
  username: process.env.QUEUEDASH_AUTH_USERNAME!,
  password: process.env.QUEUEDASH_AUTH_PASSWORD!,
  session: {
    secret: process.env.QUEUEDASH_AUTH_SESSION_SECRET,
    ttlSeconds: 12 * 60 * 60,
    secure: true,
  },
} satisfies QueuedashAuthOptions;

createQueuedashExpressMiddleware({ auth, ctx });
```

`mode` defaults to `"session"`. In session mode:

- The dashboard HTML remains available so React can render the configured name
  and logo on the login screen.
- `/auth/login` validates a Basic credential header once and returns a signed,
  `HttpOnly`, `SameSite=Strict` cookie.
- `/auth/session` checks the current session and `/auth/logout` clears it.
- Every tRPC request is rejected server-side until its session is valid.
- Passwords and session tokens are never placed in local or session storage.

Sessions default to 12 hours. `session.ttlSeconds` is bounded between 60 seconds
and 30 days. Cookies use `Secure` when the adapter sees HTTPS; use
`session.secure: true` when TLS terminates before the application. Changing the
configured username or password invalidates all existing sessions.

When `session.secret` is omitted, Queuedash creates a random process-local
signing secret and sessions end when the process restarts. Configure the same
strong `session.secret` on every replica when sessions must survive restarts or
load balancing. The signing secret and credentials are never serialized to the
browser.

Set `mode: "basic"` for the browser-native HTTP Basic challenge used by
Queuedash 3.20. Omitting `auth` keeps the integration public.

This is intentionally a single shared credential, not users, roles, SSO, rate
limiting, or an account system. Use HTTPS and consider an authenticated reverse
proxy when stronger identity controls are required.

## Context

Every integration receives the same server-owned `Context`:

```typescript
import type { Context } from "@queuedash/api";

const ctx: Context = {
  queues,
  discovery,
  ui,
  privacy,
  access,
  search,
};
```

```typescript
type Context = {
  queues?: QueuedashQueue[];
  discovery?: QueuedashQueueDiscoveryConfig;
  ui?: QueuedashUiConfig;
  privacy?: QueuedashPrivacyConfig;
  access?: QueuedashAccessConfig;
  search?: QueuedashSearchConfig;
};
```

### Static queues

```typescript
const ctx: Context = {
  queues: [
    {
      queue: reportsQueue,
      displayName: "Reports",
      type: "bullmq",
      jobName: (data) => String(data.reportName ?? "Report"),
    },
  ],
};
```

`queue` accepts a Bull, BullMQ, Bee-Queue, or GroupMQ queue instance. The
optional `jobName(data)` callback controls the display name derived from job
data.

### Redis queue discovery

```typescript
const ctx: Context = {
  discovery: {
    type: "bullmq",
    connectionUrl: "redis://localhost:6379",
    prefix: "bull",
    refreshIntervalMs: 30_000,
    maxQueues: 100,
    include: (queueName) => !queueName.startsWith("internal-"),
    displayName: (queueName) => queueName.replaceAll("-", " "),
  },
};
```

Discovery:

- Supports Bull and BullMQ metadata in a single Redis instance
- Uses incremental Redis `SCAN`, never `KEYS`
- Caches the last successful registry
- Keeps the last known-good registry during a temporary Redis outage
- Can be combined with static queues
- Does not support Bee-Queue, GroupMQ, or Redis Cluster

### Branding and dashboard defaults

```typescript
const ctx: Context = {
  queues,
  ui: {
    instanceId: "operations",
    branding: {
      name: "Acme Queues",
      logoUrl: "/assets/acme-logo.svg",
      logoAlt: "Acme",
    },
    defaults: {
      theme: "system",
      refreshIntervalMs: 2_000,
      jobsPerPage: 30,
      defaultJobStatus: "remember",
      density: "comfortable",
      timestamps: "absolute",
      showOverviewMetrics: true,
    },
  },
};
```

`instanceId` scopes browser-local preferences. Server defaults remain visible
in Settings but can be overridden in the current browser.

### Queue access

```typescript
const ctx: Context = {
  queues,
  access: {
    default: "full",
    rules: [
      {
        queues: ["payments-*"],
        mode: "read-only",
      },
      {
        queues: ["internal-*"],
        mode: "hidden",
      },
      {
        queues: ["email"],
        deny: ["queue.empty", "job.remove"],
      },
    ],
  },
};
```

Available modes are `full`, `read-only`, and `hidden`. Queue patterns support
`*` wildcards. Later matching rules can change the mode; denied actions
accumulate.

Supported action identifiers:

- `queue.pause`
- `queue.resume`
- `queue.empty`
- `queue.clean`
- `job.add`
- `job.retry`
- `job.promote`
- `job.discard`
- `job.rerun`
- `job.remove`
- `scheduler.add`
- `scheduler.remove`

Every mutation checks its effective server policy. Hidden queues are omitted
from listings, resolve as not found, and are not disclosed through Settings
metadata.

### Privacy and redaction

```typescript
const ctx: Context = {
  queues,
  privacy: {
    redact: {
      includeDefaultKeys: true,
      keys: ["customerSecret"],
      paths: ["data.customer.ssn", "opts.headers.authorization"],
      replacement: "[REDACTED]",
    },
    expose: {
      jobData: true,
      jobOptions: true,
      returnValues: false,
      stacktraces: false,
      logs: false,
      schedulerData: true,
    },
  },
};
```

`redact: true` enables the built-in sensitive-key policy. An object extends or
replaces that policy. Keys match case-insensitively at any depth; paths are
dot-separated and support `*` for one segment.

Data categories set to `false` are withheld before tRPC serialization. Hidden
content is unavailable to the browser and job search.

### Search limits

```typescript
const ctx: Context = {
  queues,
  search: {
    maxScanned: 1_000,
  },
};
```

Job search is scoped to one queue, searches only server-presented data, and
accepts a hard server cap from 25 to 5,000 jobs per request.

## Queue capabilities

The API reports adapter capabilities to the UI, which removes unsupported
controls.

| Queue     | Discovery | Workers | Schedulers | Metrics | Groups            |
| --------- | --------- | ------- | ---------- | ------- | ----------------- |
| Bull      | Yes       | Yes     | No         | No      | No                |
| BullMQ    | Yes       | Yes     | Yes        | Yes     | Runtime-dependent |
| Bee-Queue | No        | No      | No         | No      | No                |
| GroupMQ   | No        | No      | No         | No      | Yes               |

Job statuses and mutation support also vary by adapter. Unsupported operations
fail server-side even if invoked outside the UI.

## Security

Queuedash can mutate production queues. Enable adapter authentication or
protect both the dashboard and its tRPC endpoint with private networking or an
authenticated reverse proxy.

The `access` policy controls queue visibility and mutation authority, but it is
not per-user authorization or role management. Use `privacy` controls to ensure
sensitive job content is removed before responses reach a browser.

## Compatibility aliases

New integrations should use `Queuedash`. The former
`createQueueDashExpressMiddleware`, Fastify plugin, hook types, and related
`QueueDash*` names remain available as deprecated compatibility aliases.

See the [main Queuedash documentation](https://github.com/alexbudure/queuedash)
for Docker, direct UI embedding, and project-wide guidance.
