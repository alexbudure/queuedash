> **WIP** - This is a work in progress. Please check back later.

<p align="center">
  <a href="https://www.queuedash.com" target="_blank" rel="noopener">
    <img src="https://res.cloudinary.com/driverseat/image/upload/v1677406730/queuedash/queuedash-social.png" alt="QueueDash">
  </a>
</p>

<p align="center">
  A stunning, sleek dashboard for Bull, BullMQ, and Bee-Queue
<p>

<p align="center">
  <a aria-label="NPM version" href="https://www.npmjs.com/package/turbo">
    <img alt="" src="https://img.shields.io/npm/v/@queuedash/api.svg?style=for-the-badge&labelColor=000000">
  </a>
  <a aria-label="License" href="https://github.com/vercel/turbo/blob/main/LICENSE">
    <img alt="" src="https://img.shields.io/npm/l/@queuedash/api.svg?style=for-the-badge&labelColor=000000&color=">
  </a>
</p>

## Features

- 😍&nbsp; Simple, clean, and compact UI
- 🧙&nbsp; Add jobs to queue with ease
- 🪄&nbsp; Retry, remove, and more actions for jobs
- 📊&nbsp; Stats for job counts, job durations, and job wait times
- ✨&nbsp; Top-level overview page of all queues
- 🔋&nbsp; Next.js, Express.js, and Fastify adapters
- ⚡️&nbsp; Compatible with Bull, BullMQ, and Bee-Queue

## Use

### Express

`pnpm install @queuedash/api`

```typescript
import express from "express";
import Bull from "bull";
import { createQueueDashExpressMiddleware } from "@queuedash/api";

const app = express();

createQueueDashExpressMiddleware({
  app,
  baseUrl: "/queuedash",
  ctx: {
    queues: [
      {
        queue: new Bull("report-queue"),
        displayName: "Reports",
        type: "bull",
      },
    ],
  },
});

app.listen(3000, () => {
  console.log("Listening on port 3000");
});
```

### Next.js

`pnpm install @queuedash/api @queuedash/ui`

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

// pages/api/queuedash/[trpc].ts
import * as trpcNext from "@trpc/server/adapters/next";
import { appRouter } from "@queuedash/api";

export default trpcNext.createNextApiHandler({
  router: appRouter,
  batching: {
    enabled: true,
  },
  createContext: () => ({
    queues: [{ queue: new Bull("report-queue"), displayName: "Reports" }],
  }),
});
```

See the [./examples](./examples) folder for more.

---

## API Reference

### `<QueueDashApp />`

```typescript jsx
type QueueDashAppProps = {
  apiUrl: string; // URL to the API endpoint
  basename: string; // Base path for the app
};
```

### `Context`

- `queues` - Array of queues to display
  - `queue` - Queue instance
  - `displayName` - Display name for the queue
