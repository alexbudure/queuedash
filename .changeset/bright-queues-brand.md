---
"@queuedash/api": major
"@queuedash/client": major
"@queuedash/ui": major
---

Queuedash 4 redesigns the dashboard and adds a real login, per-queue access control, privacy controls and automatic queue discovery.

**Before you upgrade**

- Node 22 or newer is required.
- The dashboard now signs in through its own login page and a session cookie, instead of the browser's Basic Auth prompt. Set `auth.mode: "basic"` to keep the old prompt.
- BullMQ 5.60 or newer is required. BullMQ 6 is supported too.
- Public names are now cased consistently, for example `createQueuedashExpressMiddleware`, `fastifyQueuedashPlugin` and `QueuedashApp`. The old `QueueDash*` names still work but are deprecated.
- `@queuedash/ui` no longer depends on `@queuedash/api`. If your backend was getting the API package through the UI, install `@queuedash/api` directly.
- The Hono adapter no longer needs `@hono/trpc-server`.
- Auth options are checked when the dashboard is mounted, so a typo in `mode` or a password read as a number fails at startup instead of on the first request.
- If you serve the tRPC API from your own handler, reject `POST` requests that aren't `application/json`, as the built-in adapters now do. Otherwise a plain form on another website can pause or resume your queues.

**New**

- A redesigned dashboard: a new look, an overview of every queue, pinned queues and live status in the sidebar, a ⌘K command palette, and a job panel you can step through with the keyboard.
- Branding and defaults from your server: set the name, logo, favicon and default settings with `ui.branding` and `ui.defaults`. Use `ui.instanceId` to keep browser settings separate when several dashboards share a domain.
- Access rules: make any queue full, read-only or hidden, and turn off individual actions such as removing jobs.
- Privacy controls: redact sensitive fields, hide whole categories (job data, options, return values, stack traces, logs, scheduler data), or hide job ids. Hidden ids show as short pseudonyms, so the dashboard still opens the right job.
- Queue discovery: opt in to find Bull and BullMQ queues in Redis on their own.
- Search and filtering: filter jobs by text, search every status for a job id, and sort by date. Filters and the open job live in the URL, so you can share a link.
- Bulk actions: retry, remove or promote many jobs at once, with a count of what worked.
- BullMQ scheduler editing, worker inspection, and a Settings page for per-browser preferences.
- Support for BullMQ 6 alongside 5, and Bee-Queue 2 alongside 1.
- The Fastify plugin can be registered inside a route prefix.
- The dashboard's styles are scoped to its own root, so they don't clash with your app's CSS.
- The Docker image runs on Node 24, bundles BullMQ 6, and accepts `ui.documentTitle`.

**Fixes**

- Emptying a Bull queue no longer stops its repeatable jobs or quietly un-pauses a paused queue.
- The Docker image no longer overwrites your BullMQ queues' settings, such as the events stream length, when it connects.
- A job id that matches one of the queue's own Redis keys, like `meta`, is treated as not found instead of deleting that key.
- Health numbers are right: "Last minute" no longer shows double the real rate, an idle queue stops showing its old throughput, trend badges compare against the previous period, and sparklines read left to right.
- Removing several jobs at once reports how many failed instead of failing the whole request.
- The queue page still loads when your Redis user isn't allowed to run `INFO`.
- A job that failed an attempt and then succeeded no longer shows as failed in the job panel or the table, and no longer offers Retry. Failed jobs get a cross in their timeline instead of a check mark.
- The queue page no longer shows Redis's blocked-client count. It covered the whole server and counted every idle worker, so healthy queues looked broken.
