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

Queuedash requires Node 22 or newer, the oldest release line still receiving
security updates, and is built and tested on Node 24.

Bull, BullMQ, Bee-Queue, GroupMQ, Express, Fastify, Hono, and Elysia are
optional peer dependencies. Install only the libraries used by your
application. BullMQ integrations work with BullMQ 5 (5.60 or newer, so
scheduler updates can safely preserve the complete native scheduler definition)
and with BullMQ 6. Bee-Queue integrations work with Bee-Queue 1 and 2, whose
only difference is that 2 requires Node 20. Queuedash looks at each queue
instance rather than at an installed version, so it follows whichever major
your application uses.

On BullMQ 6, queues must be backed by Redis. BullMQ 6 keeps a paused queue's
jobs in Waiting, so Queuedash shows them there and marks the queue as paused.
Jobs that a BullMQ 5 producer parked in the older Paused list still appear under
Paused and count toward Empty's total, so that backlog is never hidden. BullMQ 6
also drops legacy repeatable jobs, so migrate those to Job Schedulers before
upgrading, as BullMQ itself requires.

Queuedash uses the BullMQ your own application installs, so keep it at or ahead
of the one your producers use. A BullMQ 5 dashboard that resumes a queue whose
producers run BullMQ 6 drops the jobs they added during the pause, because the
majors disagree on where a paused queue's jobs live. The reverse is safe:
BullMQ 6 migrates a paused list that BullMQ 5 left behind.

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

The plugin also works inside a Fastify prefix, such as
`server.register(fastifyQueuedashPlugin, { prefix: "/admin", baseUrl: "/queuedash", ctx })`:
authentication, the dashboard's API URL, and the session cookie path all follow
the full `/admin/queuedash` mount.

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
separately. In Next.js, add `@queuedash/api` to `serverExternalPackages`: it
loads each queue library only when a queue needs it, which Next's bundler
can't follow. Custom handlers must protect the tRPC route with authentication,
set `Cache-Control: private, no-store` on every success and error response, and
reject tRPC `POST` requests whose `Content-Type` is not `application/json` with
`415`. The last rule matters because tRPC also runs mutations posted as
`multipart/form-data`, which any website can submit from a plain HTML form
without a CORS preflight; the built-in adapters enforce it. In a Fetch API
handler, such as a Next.js route, call `rejectNonJsonPost(request)` first: it
returns that `415` response, or `undefined` when the request can go on to tRPC.
The Queuedash UI also requests tRPC data with `cache: "no-store"`, but only the
server response header protects data from shared intermediary caches.

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

Auth options are checked when the dashboard is mounted, not on the first
request: an unknown `mode`, a username or password that is not a non-empty
string, or a session secret that is not a string (a common result of reading
numbers from JSON or YAML configuration) throws at startup with a message naming
the field.

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

Create the queue instances and `ctx` once when the dashboard mount starts, then
reuse that same object for every request. The registry is scoped to the context
object so separate mounts cannot share queues or policy by accident. In custom
tRPC handlers, return the module-scoped `ctx` from `createContext`; do not
construct queues or an equivalent context inside the request callback.

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

Fastify awaits cleanup of discovery-owned Redis connections during shutdown.
Elysia starts the same cleanup from its stop hook, but Elysia does not await
asynchronous stop callbacks; call and await `closeQueuedashContext(ctx)` before
`app.stop()` when deterministic cleanup is required. Express, Hono, and custom
tRPC mounts should also await that helper when the dashboard shuts down. Static
queue instances remain owned by your application and are never closed by it.

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
      faviconUrl: "/assets/acme-favicon.svg",
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
- `queue.setConcurrency`
- `queue.setRateLimit`
- `queue.clearRateLimit`
- `job.add`
- `job.retry`
- `job.promote`
- `job.discard`
- `job.rerun`
- `job.remove`
- `job.update`
- `job.changeDelay`
- `job.changePriority`
- `job.removeDeduplication`
- `scheduler.add`
- `scheduler.update`
- `scheduler.remove`

Every mutation checks its effective server policy. Hidden queues are omitted
from listings, resolve as not found, and are not disclosed through Settings
metadata.

### Bounded filtering and bulk actions

`job.list` accepts optional `query`, `searchInData`, `scanLimit`, and `sort`
inputs. Filtering is status-scoped, operates on the server-presented redacted
job shape, and returns `searchMeta` when a bounded scan is used. The hard server
ceiling remains 5,000 inspected jobs.

It also takes a job `name` and a date range: `from` and `to` in epoch
milliseconds, or `fromOffset` and `toOffset` in milliseconds from when the
request runs (negative for the past), which keeps a polled "last hour" the last
hour. Completed and failed jobs are judged by when they finished, delayed jobs
by when they're due, and every other status by when it was added. BullMQ and
Bull keep finished jobs sorted by finish time, so a range over them is read
directly, with an exact count and no scan limit.

`job.bulkPromoteByFilter`, `job.bulkRemoveByFilter`, and
`job.bulkRetryByFilter` reuse that bounded filter. They process mutations with
limited concurrency and report scanned, matched, succeeded, failed, and partial
counts. Single-job promotion also verifies that the job is currently delayed.

BullMQ exposes `scheduler.update` through native job-scheduler upsert semantics.
The corresponding access action can be denied separately. Bee-Queue rejects
non-empty add-job options because its adapter cannot apply them safely.

Manual add-job options are allowlisted per adapter. Bull and BullMQ accept
ordinary execution controls such as delay, attempts, backoff, priority,
and retention; GroupMQ accepts group ID, delay/run time, ordering,
`maxAttempts`, and job ID. Scheduling, repeat, parent-flow, and internal queue fields are
rejected—create schedules through the scheduler controls instead. Custom Bull
and BullMQ job IDs are intentionally unavailable because they share the queue's
internal Redis key namespace. GroupMQ group IDs must be 1–256 characters and
cannot contain colons or control characters because those delimit the queue's
internal Redis keys.

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

Redacting `id` hides job identity. Each job id is shown as the replacement text
followed by a short pseudonym (`[REDACTED]:3f9a…`) that is unique per job and
stable for the life of the server process but cannot be reversed, so the list
still opens the right job. The same applies to every copy of the id in its
options, such as a custom `jobId`, a repeatable job's key, or a flow child's
parent id. Each process keys its pseudonyms separately, so they differ between
instances behind a load balancer. Lookups by id, logs, and job actions are
disabled in this mode.

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

GroupMQ group inspection reads at most 5,000 groups with pending jobs. Beyond
that, the Waiting list, cross-status search, group removal, and the Groups panel
work from the first 5,000 groups Redis returns, and the job list marks its
results as capped rather than failing.

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
