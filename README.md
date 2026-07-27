<p align="center">
  <a href="https://www.queuedash.com" target="_blank" rel="noopener">
    <img src="https://res.cloudinary.com/driverseat/image/upload/v1677406730/queuedash/queuedash-social-v3.png" alt="Queuedash">
  </a>
</p>

<p align="center">
  <strong>A beautiful, modern queue dashboard for Bull, BullMQ, Bee-Queue, and GroupMQ.</strong>
</p>

<p align="center">
  <a aria-label="NPM version" href="https://www.npmjs.com/package/@queuedash/api">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@queuedash/api.svg?style=flat-square">
  </a>
  <a aria-label="License" href="https://github.com/alexbudure/queuedash/blob/main/LICENSE">
    <img alt="MIT license" src="https://img.shields.io/npm/l/@queuedash/api.svg?style=flat-square">
  </a>
</p>

Queuedash gives queue operators a polished overview without giving up control of
where the dashboard runs or which data and actions it exposes.

## Features

- A clean, responsive overview for multiple queues
- Job inspection, bounded search, filtering, and status-aware actions
- Queue counts plus duration, wait-time, and throughput metrics where supported
- Job schedulers, worker inspection, flows, priorities, and groups where supported
- Optional Redis discovery for Bull and BullMQ queues
- Server-enforced full, read-only, hidden, and action-specific queue policies
- Sensitive-key redaction and whole-category data exposure controls
- A branded login with signed, HttpOnly sessions and explicit logout
- Server-provided defaults with instance-scoped browser preferences
- Custom product name, logo, and accessible logo text
- Express, Fastify, Hono, Elysia, Next.js, direct React, and Docker integrations
- Scoped, specificity-hardened styles that do not leak into the host application

## Quick start

Install Queuedash alongside the queue and web framework your application already
uses:

```bash
npm install @queuedash/api
```

Mount the Express middleware with at least one queue:

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

Open [http://localhost:3000/queuedash](http://localhost:3000/queuedash).

## Integrations

| Runtime      | Queuedash API                                     | Working example                            |
| ------------ | ------------------------------------------------- | ------------------------------------------ |
| Express      | `createQueuedashExpressMiddleware`                | [Express](./examples/with-express)         |
| Fastify      | `fastifyQueuedashPlugin`                          | [Fastify](./examples/with-fastify)         |
| Hono         | `createHonoAdapter`                               | [Hono](./examples/with-hono)               |
| Elysia / Bun | `queuedash`                                       | [Elysia](./examples/with-elysia-and-bun)   |
| Next.js      | `appRouter` + `<QueuedashApp />`                  | [Next.js App Router](./examples/with-next) |
| Docker       | `QUEUES_CONFIG_JSON` or `QUEUES_CONFIG_FILE_PATH` | [Docker](#docker)                          |

For direct React or Next.js embedding, see
[`@queuedash/ui`](./packages/ui/README.md). Server and policy configuration is
documented under [`@queuedash/api`](./packages/api/README.md).

## Queue support

Queuedash detects adapter capabilities and hides unsupported controls.

| Queue     | Static configuration | Redis discovery | Workers | Schedulers | Docker |
| --------- | -------------------- | --------------- | ------- | ---------- | ------ |
| Bull      | Yes                  | Yes             | Yes     | No         | Yes    |
| BullMQ    | Yes                  | Yes             | Yes     | Yes        | Yes    |
| Bee-Queue | Yes                  | No              | No      | No         | Yes    |
| GroupMQ   | Yes                  | No              | No      | No         | No     |

BullMQ also provides the broadest metrics, logs, flow, priority, and scheduler
support. GroupMQ exposes its native groups. Bee-Queue remains intentionally
limited to operations supported safely by its API.

## Configuration

All server-owned behavior lives in the Queuedash API context. The dashboard
cannot override access, privacy, discovery, or search limits from the browser.

### Branding and dashboard defaults

```typescript
createQueuedashExpressMiddleware({
  ctx: {
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
  },
});
```

`instanceId` scopes browser-local preferences when multiple Queuedash instances
share an origin.

### Authentication

Express, Fastify, Hono, and Elysia accept an optional `auth` configuration next
to `ctx`:

```typescript
createQueuedashExpressMiddleware({
  auth: {
    username: process.env.QUEUEDASH_AUTH_USERNAME!,
    password: process.env.QUEUEDASH_AUTH_PASSWORD!,
    session: {
      secret: process.env.QUEUEDASH_AUTH_SESSION_SECRET,
      ttlSeconds: 12 * 60 * 60,
      secure: true,
    },
  },
  ctx: {
    queues,
    ui: {
      branding: {
        name: "Acme Queues",
        logoUrl: "/assets/acme-logo.svg",
      },
    },
  },
});
```

The default `session` mode serves the branded login screen, validates the
configured credentials, and issues a signed, `HttpOnly`, `SameSite=Strict`
cookie scoped to the Queuedash mount path. Credentials are not stored in
browser storage. The dashboard shell can load before login, but every tRPC data
request remains protected server-side.

Use HTTPS in production. The cookie follows the request protocol by default;
set `session.secure: true` when TLS terminates at a reverse proxy. Rotating the
configured username or password invalidates existing sessions. Without
`session.secret`, Queuedash generates a process-local signing secret, so
sessions end on restart. Set the same strong secret on every replica when
sessions must survive restarts or load balancing.

Set `mode: "basic"` to retain the browser-native HTTP Basic prompt. The bundled
auth remains a single configured credential, not user management, SSO, or RBAC.

### Queue access

```typescript
createQueuedashExpressMiddleware({
  ctx: {
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
  },
});
```

Queue patterns support `*` wildcards. Rules are evaluated in order: later
matching rules can change the mode, while denied actions accumulate. Hidden
queues are omitted from listings, resolve as not found, and are not disclosed
by Settings policy metadata. Read-only and denied actions are enforced by the
API, not only hidden in the interface.

### Privacy

```typescript
createQueuedashExpressMiddleware({
  ctx: {
    queues,
    privacy: {
      redact: {
        keys: ["customerSecret"],
        paths: ["data.customer.ssn", "opts.headers.authorization"],
        replacement: "[REDACTED]",
      },
      expose: {
        stacktraces: false,
        logs: false,
        returnValues: false,
      },
    },
  },
});
```

Redaction is applied recursively before tRPC serialization. Categories disabled
through `privacy.expose` are withheld entirely and cannot be searched or
recovered by the browser.

### Queue discovery

```typescript
createQueuedashExpressMiddleware({
  ctx: {
    discovery: {
      type: "bullmq",
      connectionUrl: "redis://localhost:6379",
      prefix: "bull",
      refreshIntervalMs: 30_000,
      maxQueues: 100,
    },
  },
});
```

Discovery is opt-in, uses incremental Redis `SCAN` against queue metadata keys,
and keeps a cached registry. It currently supports a single Redis URL for Bull
or BullMQ. Use explicit static queues for Bee-Queue, GroupMQ, and Redis Cluster.
Static and discovered queues can be combined.

Programmatic configuration can also provide `include(queueName)` and
`displayName(queueName)` functions.

### Search

```typescript
createQueuedashExpressMiddleware({
  ctx: {
    queues,
    search: {
      maxScanned: 1_000,
    },
  },
});
```

Job search runs within the selected queue. It searches only server-presented
data and never scans more than the configured hard limit of 25 to 5,000 jobs
per request.

### Browser-local preferences

Theme, auto-refresh, jobs per load, default job tab, table density, timestamps,
overview metrics, and pinned queues can be changed from Settings. They remain in
the current browser, are scoped by `instanceId` or `basename`, and never sync to
the server. Resetting local settings restores the server-provided defaults.

## Docker

Run the published image with inline JSON:

```bash
docker run -p 3000:3000 \
  -e QUEUEDASH_AUTH_USERNAME='admin' \
  -e QUEUEDASH_AUTH_PASSWORD='change-me' \
  -e QUEUES_CONFIG_JSON='{"queues":[{"name":"reports","displayName":"Reports","type":"bullmq","connectionUrl":"redis://host.docker.internal:6379"}]}' \
  ghcr.io/alexbudure/queuedash:latest
```

Then open [http://localhost:3000](http://localhost:3000).

Use `QUEUES_CONFIG_FILE_PATH` instead of `QUEUES_CONFIG_JSON` to load the same
configuration from a mounted file. Docker supports Bull, BullMQ, and Bee-Queue
static queues; Redis discovery supports Bull and BullMQ. BullMQ static queues
may use either `connectionUrl` or `clusterNodes`.

The Docker JSON schema accepts the same `ui`, `privacy`, `access`, `search`, and
`discovery` settings described above, excluding programmatic callback functions.

Authentication environment variables:

- `QUEUEDASH_AUTH_USERNAME` and `QUEUEDASH_AUTH_PASSWORD` enable authentication.
- `QUEUEDASH_AUTH_MODE` selects `session` (default) or `basic`.
- `QUEUEDASH_AUTH_SESSION_SECRET` shares session signing across restarts and replicas.
- `QUEUEDASH_AUTH_SESSION_TTL_SECONDS` sets a session lifetime from 60 seconds to 30 days.
- `QUEUEDASH_AUTH_COOKIE_SECURE` explicitly selects `true` or `false` for the `Secure` cookie attribute.

## Security

Queuedash is an operational admin tool. Depending on its policy, it can add,
retry, promote, remove, clean, empty, pause, and resume production queue data.

- Enable bundled authentication or protect both routes with an authenticated reverse proxy.
- Prefer private networking or an authenticated reverse proxy over public exposure.
- Use `access` policies to remove unnecessary mutation authority.
- Use `privacy.redact` and `privacy.expose` before sensitive data reaches a browser.
- Treat hidden and read-only modes as server policy, not as a replacement for authentication.

Bundled authentication provides one configured credential and signed browser
sessions. It does not provide separate users, identity federation, or
role-based authentication.

## Packages

| Package                                            | Purpose                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| [`@queuedash/api`](./packages/api/README.md)       | Queue adapters, tRPC router, discovery, privacy, and access enforcement |
| [`@queuedash/ui`](./packages/ui/README.md)         | React dashboard for Next.js and direct embedding                        |
| [`@queuedash/client`](./packages/client/README.md) | Prebuilt browser entrypoint used by server-rendered adapters            |

The former `QueueDashApp`, `createQueueDashExpressMiddleware`, Fastify plugin,
and related `QueueDash*` names remain available as deprecated compatibility
aliases. New integrations should use `Queuedash`.

## Queuedash Pro

For alerts and notifications, longer-term queue trends, and team access, visit
[queuedash.com](https://www.queuedash.com).

## Acknowledgements

Queuedash was inspired by several excellent open-source projects:

- [bull-board](https://github.com/vcapretz/bull-board)
- [bull-monitor](https://github.com/s-r-x/bull-monitor)
- [bull-arena](https://github.com/bee-queue/arena)
