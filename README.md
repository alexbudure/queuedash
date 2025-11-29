<p align="center">
  <a href="https://www.queuedash.com" target="_blank" rel="noopener">
    <img src="https://res.cloudinary.com/driverseat/image/upload/v1677406730/queuedash/queuedash-social.png" alt="QueueDash">
  </a>
</p>

<p align="center">
  A stunning, sleek dashboard for Bull, BullMQ, Bee-Queue, and GroupMQ.
<p>

<p align="center">
  <a aria-label="NPM version" href="https://www.npmjs.com/package/@queuedash/api">
    <img alt="" src="https://img.shields.io/npm/v/@queuedash/api.svg?style=for-the-badge&labelColor=000000">
  </a>
  <a aria-label="License" href="https://github.com/alexbudure/queuedash/blob/main/LICENSE">
    <img alt="" src="https://img.shields.io/npm/l/@queuedash/api.svg?style=for-the-badge&labelColor=000000&color=">
  </a>
</p>

## Features

- 😍&nbsp; Simple, clean, and compact UI
- 🧙&nbsp; Add jobs to your queue with ease
- 🪄&nbsp; Retry, remove, and more convenient actions for your jobs
- 📊&nbsp; Stats for job counts, job durations, and job wait times
- ✨&nbsp; Top-level overview page of all queues
- 🔋&nbsp; Integrates with Next.js, Express.js, and Fastify
- ⚡️&nbsp; Compatible with Bull, BullMQ, Bee-Queue, and GroupMQ
- 📅&nbsp; Job scheduler support
- 📈&nbsp; Metrics for queue performance

## Getting Started

### Express

`pnpm install @queuedash/api`

```typescript
import express from "express";
import Bull from "bull";
import { createQueueDashExpressMiddleware } from "@queuedash/api";

const app = express();

const reportQueue = new Bull("report-queue");

app.use(
  "/queuedash",
  createQueueDashExpressMiddleware({
    ctx: {
      queues: [
        {
          queue: reportQueue,
          displayName: "Reports",
          type: "bull" as const,
        },
      ],
    },
  })
);

app.listen(3000, () => {
  console.log("Listening on port 3000");
  console.log("Visit http://localhost:3000/queuedash");
});
```

### Next.js

`pnpm install @queuedash/api @queuedash/ui`

#### App Router
```typescript jsx
// app/admin/queuedash/[[...slug]]/page.tsx
"use client";

import { QueueDashApp } from "@queuedash/ui";
import "@queuedash/ui/dist/styles.css";

function getBaseUrl() {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/api/queuedash`;
  }

  return `http://localhost:${process.env.PORT ?? 3000}/api/queuedash`;
}

export default function QueueDashPages() {
  return <QueueDashApp apiUrl={getBaseUrl()} basename="/admin/queuedash" />;
}
```

```typescript jsx
// app/api/queuedash/[...trpc]/route.ts
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@queuedash/api";

const reportQueue = new Bull("report-queue");

function handler(req: Request) {
  return fetchRequestHandler({
    endpoint: "/api/queuedash",
    req,
    router: appRouter,
    allowBatching: true,
    createContext: () => ({
    queues: [
      {
        queue: reportQueue,
        displayName: "Reports",
        type: "bull" as const,
      },
    ],
  });
}

export { handler as GET, handler as POST };
```

#### Pages Router

```typescript jsx
// pages/admin/queuedash/[[...slug]].tsx
import { QueueDashApp } from "@queuedash/ui";

function getBaseUrl() {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/api/queuedash`;
  }

  return `http://localhost:${process.env.PORT ?? 3000}/api/queuedash`;
}

const QueueDashPages = () => {
  return <QueueDashApp apiUrl={getBaseUrl()} basename="/admin/queuedash" />;
};

export default QueueDashPages;
```

```typescript jsx
// pages/api/queuedash/[trpc].ts
import * as trpcNext from "@trpc/server/adapters/next";
import { appRouter } from "@queuedash/api";

const reportQueue = new Bull("report-queue");

export default trpcNext.createNextApiHandler({
  router: appRouter,
  batching: {
    enabled: true,
  },
  createContext: () => ({
    queues: [
      {
        queue: reportQueue,
        displayName: "Reports",
        type: "bull" as const,
      },
    ],
  }),
});
```

### Docker

The fastest way to get started is using the official Docker image:

```bash
docker run -p 3000:3000 \
  -e QUEUES_CONFIG_JSON='{"queues":[{"name":"my-queue","displayName":"My Queue","type":"bullmq","connectionUrl":"redis://localhost:6379"}]}' \
  ghcr.io/alexbudure/queuedash:latest
```

Then visit http://localhost:3000

#### Environment Variables

- `QUEUES_CONFIG_JSON` - **Required**. JSON string containing queue configuration

Example configuration:
```json
{
  "queues": [
    {
      "name": "cancellation-follow-ups",
      "displayName": "Cancellation follow-ups",
      "type": "bullmq",
      "connectionUrl": "redis://localhost:6379"
    },
    {
      "name": "email-queue",
      "displayName": "Email Queue",
      "type": "bull",
      "connectionUrl": "redis://localhost:6379"
    }
  ]
}
```

Supported queue types: `bull`, `bullmq`, `bee`, `groupmq`


See the [./examples](./examples) folder for more.

---

## API Reference

### `createQueueDash<*>Middleware`

```typescript
type QueueDashMiddlewareOptions = {
  app: express.Application | FastifyInstance; // Express or Fastify app
  baseUrl: string; // Base path for the API and UI
  ctx: QueueDashContext; // Context for the UI
};

type QueueDashContext = {
  queues: QueueDashQueue[]; // Array of queues to display
};

type QueueDashQueue = {
  queue: Bull.Queue | BullMQ.Queue | BeeQueue; // Queue instance
  displayName: string; // Display name for the queue
  type: "bull" | "bullmq" | "bee" | "groupmq"; // Queue type
};
```

### `<QueueDashApp />`

```typescript jsx
type QueueDashAppProps = {
  apiUrl: string; // URL to the API endpoint
  basename: string; // Base path for the app
};
```

## Need more?

If you need more capabilities, check out [queuedash.com](https://www.queuedash.com):

- Alerts and notifications
- Quick search and filtering
- Queue trends and analytics
- Invite team members

## Acknowledgements

QueueDash was inspired by some great open source projects. Here's a few of them:

- [bull-board](https://github.com/vcapretz/bull-board)
- [bull-monitor](https://github.com/s-r-x/bull-monitor)
- [bull-arena](https://github.com/bee-queue/arena)
