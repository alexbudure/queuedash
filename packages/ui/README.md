# `@queuedash/ui`

The beautiful Queuedash React application for Next.js and direct embedding.

[![NPM version](https://img.shields.io/npm/v/@queuedash/ui.svg?style=flat-square)](https://www.npmjs.com/package/@queuedash/ui)
[![MIT license](https://img.shields.io/npm/l/@queuedash/ui.svg?style=flat-square)](https://github.com/alexbudure/queuedash/blob/main/LICENSE)

Use `@queuedash/ui` when your application serves the Queuedash tRPC API itself.
Express, Fastify, Hono, and Elysia integrations can instead use
[`@queuedash/api`](https://www.npmjs.com/package/@queuedash/api) to serve the
prebuilt dashboard automatically.

## Install

```bash
npm install @queuedash/api @queuedash/ui
```

`@queuedash/ui` supports React and React DOM 18 or newer.

## Basic usage

Import the distributed stylesheet once, then render the app with the tRPC
endpoint and browser-router base path:

```tsx
import { QueuedashApp } from "@queuedash/ui";
import "@queuedash/ui/dist/styles.css";

export function QueueAdmin() {
  return <QueuedashApp apiUrl="/api/queuedash" basename="/queuedash" />;
}
```

```typescript
type QueuedashAppProps = {
  apiUrl: string;
  basename: string;
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
  auth?: {
    baseUrl: string;
  };
  ui?: QueuedashUiConfig;
};
```

- `apiUrl` points to the mounted Queuedash tRPC endpoint.
- `basename` is the browser route where the dashboard is rendered.
- `headers` adds static or asynchronously resolved headers to tRPC requests.
- `auth` enables Queuedash's session check, branded login screen, and logout
  control for a compatible auth endpoint.
- `ui` supplies branding and browser-default configuration for direct embedding.

The `headers` callback runs in the browser. Do not embed long-lived server
secrets in the client bundle.

## Next.js App Router

This example renders the dashboard at `/queuedash` and serves tRPC at
`/api/queuedash`.

Import the stylesheet from a layout:

```tsx
// app/layout.tsx
import "@queuedash/ui/dist/styles.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Render the catch-all dashboard page:

```tsx
// app/queuedash/[[...slug]]/page.tsx
"use client";

import { QueuedashApp } from "@queuedash/ui";

export default function Page() {
  return <QueuedashApp apiUrl="/api/queuedash" basename="/queuedash" />;
}
```

Mount the API router:

```typescript
// app/api/queuedash/[trpc]/route.ts
import { appRouter } from "@queuedash/api";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Queue } from "bullmq";

const reports = new Queue("reports", {
  connection: {
    url: process.env.REDIS_URL ?? "redis://localhost:6379",
  },
});

const handler = (request: Request) =>
  fetchRequestHandler({
    endpoint: "/api/queuedash",
    req: request,
    router: appRouter,
    createContext: () => ({
      queues: [
        {
          queue: reports,
          displayName: "Reports",
          type: "bullmq" as const,
        },
      ],
    }),
  });

export { handler as GET, handler as POST };
```

See the
[working Next.js example](https://github.com/alexbudure/queuedash/tree/main/examples/with-next)
for the complete project.

## Branding and defaults

Direct UI embeddings can provide a `QueuedashUiConfig`:

```tsx
<QueuedashApp
  apiUrl="/api/queuedash"
  basename="/queuedash"
  ui={{
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
  }}
/>
```

Server-rendered adapters pass `ctx.ui` into the application automatically.
They also inject the session-auth endpoint when adapter authentication is
enabled, so no UI prop is required for Express, Fastify, Hono, or Elysia.

## Branded login

When a server adapter uses Queuedash session authentication, the UI:

- Checks the existing `HttpOnly` session before rendering queue data
- Uses the configured product name, logo, and theme on the login screen
- Sends the username and password only to the login endpoint
- Keeps credentials and the session token out of browser storage
- Returns to login when a tRPC request reports an expired session
- Provides an explicit sign-out control in the dashboard navigation

Direct UI embeddings can opt into the same flow when they expose compatible
`session`, `login`, and `logout` routes:

```tsx
<QueuedashApp
  apiUrl="/api/queuedash/trpc"
  auth={{ baseUrl: "/api/queuedash/auth" }}
  basename="/queuedash"
/>
```

The session endpoints must be same-origin. For custom OAuth, SSO, or framework
sessions, omit `auth` and use the `headers` integration below.

## Browser preferences

Users can override these dashboard defaults from Settings:

- Theme
- Auto-refresh, including disabling polling
- Jobs loaded per page
- Default or remembered job-status tab
- Compact or comfortable table density
- Relative or absolute timestamps
- Overview metrics
- Pinned queues

Preferences stay in the current browser. They are stored under an
instance-scoped key derived from `instanceId` or `basename`, never sync to the
server, and can be reset to server defaults.

Access, privacy, discovery, and search policy remain server-owned and read-only
in the browser.

## Queue operations

Job filters are status-scoped and keep `q` and `sort` in the URL for shareable
views. Bulk retry, remove, and delayed-job promote actions use the server's
bounded scan and disclose partial results. Clean all is shown only when the
current adapter can clean the selected status, and it is never used while a
search or group filter is active.

BullMQ scheduler details include an Edit action when `scheduler.update` is
allowed. Queue libraries without scheduler upsert support do not expose it.
Add-job options are likewise hidden for Bee-Queue, whose API cannot apply them.

## Styles

Import:

```tsx
import "@queuedash/ui/dist/styles.css";
```

The distributed stylesheet:

- Scopes Tailwind utilities and preflight beneath `[data-queuedash-root]`
- Uses a specificity-hardened root selector
- Emits Queuedash rules outside Tailwind cascade layers
- Keeps dark mode on the Queuedash root instead of the host `<html>` element

This prevents Queuedash styles from leaking into the host and wins normal
same-named host utility collisions. A host stylesheet using `!important` or
greater specificity can still override ordinary CSS; use an iframe if the
embedding environment requires absolute style isolation.

## Authentication headers

Use `headers` when your tRPC route expects a browser session token:

```tsx
<QueuedashApp
  apiUrl="/api/queuedash"
  basename="/queuedash"
  headers={async () => ({
    Authorization: `Bearer ${await getSessionToken()}`,
  })}
/>
```

Protect the page route and API route independently. UI headers do not provide
authentication unless the server validates them.

## Compatibility alias

`QueueDashApp` remains exported as a deprecated alias. New code should import
`QueuedashApp`.

See [`@queuedash/api`](https://www.npmjs.com/package/@queuedash/api) for queue
configuration, access control, privacy, discovery, and search limits.
