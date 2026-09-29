# @queuedash/api

## 4.1.0

### Minor Changes

- [#111](https://github.com/alexbudure/queuedash/pull/111) [`3861450`](https://github.com/alexbudure/queuedash/commit/386145080337ccacf5e8dbbfdfa6011f097114a6) Thanks [@alexbudure](https://github.com/alexbudure)! - Add job has a name field now (BullMQ and Bull), with the names the queue already uses one click away. ⌘↵ (Ctrl+↵) adds from anywhere in the panel, and Add another keeps it open for the next one.

  Rerun is now Duplicate: it opens Add job filled in from the job and marks what you changed. Add it untouched and it keeps the original's real data, even the parts the dashboard redacts. Bulk Rerun is still there.

  API: `queue.addJob` takes an optional `name` (not on Bee-Queue or GroupMQ). Jobs have `rawName`, the name before any `jobName` display mapping.

- [#111](https://github.com/alexbudure/queuedash/pull/111) [`3861450`](https://github.com/alexbudure/queuedash/commit/386145080337ccacf5e8dbbfdfa6011f097114a6) Thanks [@alexbudure](https://github.com/alexbudure)! - New Errors tab: failed jobs grouped by what went wrong. A group is the error type, its message with ids and numbers masked out, and the first line of your own code in the trace. Each one shows its job count, failures per hour over the last day, and when it was first and last seen. Open one to see its jobs and retry or remove them all at once. Works on all four libraries, only groups what the viewer is allowed to see, and only covers failed jobs Redis still has.

  API: `job.errorGroups` returns the groups. `job.list`, `job.bulkRetryByFilter` and `job.bulkRemoveByFilter` take a group's fingerprint as `error`.

- [#111](https://github.com/alexbudure/queuedash/pull/111) [`3861450`](https://github.com/alexbudure/queuedash/commit/386145080337ccacf5e8dbbfdfa6011f097114a6) Thanks [@alexbudure](https://github.com/alexbudure)! - A failed job's panel shows what broke and where. The error card has the type, the message, the line of your code that threw, and how many other jobs hit the same error in the last day, linked to its Errors group. A new Attempts section lists every attempt that kept a stack trace, newest first, with node_modules and Node internals folded away. BullMQ jobs also show which worker ran them, whether it's still connected, and how often they stalled.

  Stack frames open in your editor: VS Code, Cursor, Windsurf, Zed, WebStorm, IntelliJ IDEA or a custom URL. The first time, it asks for your editor and how the workers' paths map to yours (`/app` → `/Users/you/code/app`). That's saved in your browser; change it in Settings › Code links.

  API: `job.byId` returns `errorFingerprint`. BullMQ jobs have `processedBy`, `attemptsStarted` and `stalledCounter`. Bee-Queue stack traces are oldest first now, like everyone else's.

- [#111](https://github.com/alexbudure/queuedash/pull/111) [`3861450`](https://github.com/alexbudure/queuedash/commit/386145080337ccacf5e8dbbfdfa6011f097114a6) Thanks [@alexbudure](https://github.com/alexbudure)! - Jobs in a BullMQ flow get a Flow section in their panel: the parent, the children by status, and which ones need a look. Open flow shows the whole flow across queues on one timeline: what waited, what ran, what the parent is still waiting on, and the failure holding it up, with Retry for every failed job in it. Big flows load 50 children at a time. Children in queues you can't see are counted, never named.

  API: `flow.links` returns a job's parent and first children, and `flow.tree` the whole flow from its top visible ancestor. Neither works while job ids are redacted.

- [#111](https://github.com/alexbudure/queuedash/pull/111) [`3861450`](https://github.com/alexbudure/queuedash/commit/386145080337ccacf5e8dbbfdfa6011f097114a6) Thanks [@alexbudure](https://github.com/alexbudure)! - The Health strip shows run times: p50 and p95 for jobs that finished in the selected range, with a sparkline of the median. Like the rest of the strip, it counts whole minutes and only the completed jobs the queue still keeps. With five cells in a row, sparklines now show on screens 1536px and wider.

  API: `job.runTimes` returns a queue's p50 and p95 over the last `minutes`. Bee-Queue doesn't record start times, so it has none.

### Patch Changes

- [#111](https://github.com/alexbudure/queuedash/pull/111) [`3861450`](https://github.com/alexbudure/queuedash/commit/386145080337ccacf5e8dbbfdfa6011f097114a6) Thanks [@alexbudure](https://github.com/alexbudure)! - The dashboard script the Express, Fastify, Hono and Elysia adapters load is fully minified now, about 30% smaller. `@queuedash/client` also drops a CommonJS build nothing used, and stops installing React, which it already bundles.

- [#111](https://github.com/alexbudure/queuedash/pull/111) [`3861450`](https://github.com/alexbudure/queuedash/commit/386145080337ccacf5e8dbbfdfa6011f097114a6) Thanks [@alexbudure](https://github.com/alexbudure)! - The JSON editors are CodeMirror now, bundled in. No more pulling Monaco (about 1 MB) from jsdelivr every time one opens, so they work offline, and they match each dashboard's light or dark theme. The client gets about 120 KB gzipped bigger.

- [#111](https://github.com/alexbudure/queuedash/pull/111) [`3861450`](https://github.com/alexbudure/queuedash/commit/386145080337ccacf5e8dbbfdfa6011f097114a6) Thanks [@alexbudure](https://github.com/alexbudure)! - Fonts ship inside `@queuedash/ui` instead of loading from Google Fonts, so viewers' IPs stop going to Google and the fonts work offline and under a strict CSP. Same Inter and JetBrains Mono, loaded from `dist/fonts/`, only the subsets a page needs. They use Queuedash-specific family names, so your app's own Inter is left alone.

- [#111](https://github.com/alexbudure/queuedash/pull/111) [`3861450`](https://github.com/alexbudure/queuedash/commit/386145080337ccacf5e8dbbfdfa6011f097114a6) Thanks [@alexbudure](https://github.com/alexbudure)! - Rerun keeps the job's name and run settings. It used to re-add only the data, as "Manual add" (unnamed on Bull), so workers that route by name couldn't handle it, and a job set to retry five times got one shot. Now it keeps attempts, backoff, priority, timeout, retention and the GroupMQ group, and drops the id, delay, schedule and flow parent, so it runs right away as a new job. `job.rerun` returns the new job.

- [#111](https://github.com/alexbudure/queuedash/pull/111) [`3861450`](https://github.com/alexbudure/queuedash/commit/386145080337ccacf5e8dbbfdfa6011f097114a6) Thanks [@alexbudure](https://github.com/alexbudure)! - Toasts look right again. The dashboard's CSS reset was overriding their styles, so they showed up as cramped strips with no padding and a heavy black icon. They now match menus and popovers in light and dark and stay clear of the panel's corner.

  The "Discard your changes?" toast you get when closing Add job with unsaved edits is clickable again. The open panel was making everything outside it inert, toast included.

- [#111](https://github.com/alexbudure/queuedash/pull/111) [`3861450`](https://github.com/alexbudure/queuedash/commit/386145080337ccacf5e8dbbfdfa6011f097114a6) Thanks [@alexbudure](https://github.com/alexbudure)! - Installing `@queuedash/ui` no longer drags in about 400 MB of packages. It listed 21 dependencies its build already bundles or never uses, like `monaco-editor`; now it only needs the React and React DOM you already have. The Docker image is about 270 MB lighter for the same reason.

- [#111](https://github.com/alexbudure/queuedash/pull/111) [`3861450`](https://github.com/alexbudure/queuedash/commit/386145080337ccacf5e8dbbfdfa6011f097114a6) Thanks [@alexbudure](https://github.com/alexbudure)! - The Workers cell stops calling busy workers "last seen 15m ago". That number was Redis's idle time for the connection a worker waits on, which a busy worker never touches. It now shows what the workers are doing: "1 active job", "3 active jobs" or "idle". The Workers panel shows how long each worker has been connected instead.

## 4.0.1

### Patch Changes

- [`3e8cc30`](https://github.com/alexbudure/queuedash/commit/3e8cc303e7905858baca5f2b871437fb914a1f4d) Thanks [@alexbudure](https://github.com/alexbudure)! - `@queuedash/api` 4.0.0 failed to load unless `groupmq` was installed, so apps that don't use GroupMQ crashed at startup with `Cannot find module 'groupmq'`. It now loads GroupMQ only when a GroupMQ queue needs it.

  In Next.js, also add `@queuedash/api` to `serverExternalPackages` in `next.config`. Next bundles route handlers, and its bundler fails on each queue library Queuedash loads on demand that you haven't installed. The README and example show the setting.

- [`3e8cc30`](https://github.com/alexbudure/queuedash/commit/3e8cc303e7905858baca5f2b871437fb914a1f4d) Thanks [@alexbudure](https://github.com/alexbudure)! - Add `rejectNonJsonPost` for tRPC handlers you serve yourself, such as a Next.js route. It returns the `415` the built-in adapters send for a `POST` that isn't `application/json`, or `undefined` when the request can go on to tRPC.

  The 4.0.0 Next.js README and example left this check out. If you copied that route, call `rejectNonJsonPost` before `fetchRequestHandler`, as the README now shows. Otherwise a plain form on another website can pause or resume your queues.

- [`3e8cc30`](https://github.com/alexbudure/queuedash/commit/3e8cc303e7905858baca5f2b871437fb914a1f4d) Thanks [@alexbudure](https://github.com/alexbudure)! - `@queuedash/ui` now uses your app's React for JSX as well. 4.0.0 bundled React 19's JSX runtime, which React 18 apps can't render.

## 4.0.0

### Major Changes

- [#108](https://github.com/alexbudure/queuedash/pull/108) [`eba125a`](https://github.com/alexbudure/queuedash/commit/eba125af9069e9162de24d231b94f8b7e5ef243a) Thanks [@alexbudure](https://github.com/alexbudure)! - Queuedash 4 redesigns the dashboard and adds a real login, per-queue access control, privacy controls and automatic queue discovery.

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

## 3.20.0

### Minor Changes

- [#106](https://github.com/alexbudure/queuedash/pull/106) [`ea55ae4`](https://github.com/alexbudure/queuedash/commit/ea55ae4c2bf5f7f6452467bb7cc8358119f51496) Thanks [@alexbudure](https://github.com/alexbudure)! - Add optional HTTP Basic authentication to the Express, Fastify, Hono, and Elysia adapters.

## 3.19.0

### Minor Changes

- [#101](https://github.com/alexbudure/queuedash/pull/101) [`46016b4`](https://github.com/alexbudure/queuedash/commit/46016b4c0070d9d7ef9db5b59d6271ad10e312c1) Thanks [@alexbudure](https://github.com/alexbudure)! - Tailwind v4 upgrade and a new add-job JSON editor experience

## 3.18.0

### Minor Changes

- [#102](https://github.com/alexbudure/queuedash/pull/102) [`a6cbd23`](https://github.com/alexbudure/queuedash/commit/a6cbd2370babe9f62bf8696e7155f910a419a352) Thanks [@krzkowalczyk](https://github.com/krzkowalczyk)! - Add `prefix` support for Docker JSON queue configuration.

## 3.17.0

### Minor Changes

- [#83](https://github.com/alexbudure/queuedash/pull/83) [`7704e26`](https://github.com/alexbudure/queuedash/commit/7704e2671926502de0df71bafd7953c845c65d5c) Thanks [@alexbudure](https://github.com/alexbudure)! - Add first-class group operations and bulk actions.

  - Add queue groups endpoint support and GroupMQ group aggregation improvements.
  - Add bulk retry-by-filter and bulk remove-by-group APIs.
  - Update UI group actions to operate on full filtered/grouped sets instead of only visible rows.
  - Improve GroupMQ/Bull adapter behavior consistency and extend coverage for group flows.

- [#99](https://github.com/alexbudure/queuedash/pull/99) [`9b5e9cd`](https://github.com/alexbudure/queuedash/commit/9b5e9cd079c11533ed792689b1ae4b00e429e861) Thanks [@alexbudure](https://github.com/alexbudure)! - Refreshed the UI

## 3.16.0

### Minor Changes

- [#95](https://github.com/alexbudure/queuedash/pull/95) [`851c7ed`](https://github.com/alexbudure/queuedash/commit/851c7edc51809163af63f48713172569c6560826) Thanks [@alexbudure](https://github.com/alexbudure)! - Add Redis Cluster support for Docker BullMQ queues via `clusterNodes` and `ioredis.Cluster`.

## 3.15.0

### Minor Changes

- [#92](https://github.com/alexbudure/queuedash/pull/92) [`5aab10d`](https://github.com/alexbudure/queuedash/commit/5aab10da45650680268c00afb32b089cd8dddc4d) Thanks [@dvxam](https://github.com/dvxam)! - Support queue configuration from file for docker container

## 3.14.2

### Patch Changes

- [#88](https://github.com/alexbudure/queuedash/pull/88) [`30c75b3`](https://github.com/alexbudure/queuedash/commit/30c75b3788dba09da075d4aad82da753c9425991) Thanks [@schmkr](https://github.com/schmkr)! - Fix tls connections for BullMQ, Bull and Bee

## 3.14.1

### Patch Changes

- [#84](https://github.com/alexbudure/queuedash/pull/84) [`9e5f8ff`](https://github.com/alexbudure/queuedash/commit/9e5f8ff8f319388346e1291c57791cb029bca2bb) Thanks [@larsvaehrens](https://github.com/larsvaehrens)! - Bump @trpc/server to 11.8.1 to fix [CVE-2025-68130](https://github.com/advisories/GHSA-43p4-m455-4f4j)

## 3.14.0

### Minor Changes

- [#81](https://github.com/alexbudure/queuedash/pull/81) [`ae35e0c`](https://github.com/alexbudure/queuedash/commit/ae35e0cf0be6b23650603c48ed61aa5b11edc687) Thanks [@alexbudure](https://github.com/alexbudure)! - Add headers prop for tRPC

## 3.13.0

### Minor Changes

- [#76](https://github.com/alexbudure/queuedash/pull/76) [`3eb1416`](https://github.com/alexbudure/queuedash/commit/3eb141680de9d0d84a62e2d1954e422742ff3617) Thanks [@adamjkb](https://github.com/adamjkb)! - Display job return value in job modal

### Patch Changes

- [#79](https://github.com/alexbudure/queuedash/pull/79) [`e480e9f`](https://github.com/alexbudure/queuedash/commit/e480e9f5dae0ede682cc72cc4efbac7283d4545c) Thanks [@alexbudure](https://github.com/alexbudure)! - Fix Elysia adapter

## 3.12.1

### Patch Changes

- [#71](https://github.com/alexbudure/queuedash/pull/71) [`3838d79`](https://github.com/alexbudure/queuedash/commit/3838d79398655522d2607988f8a915f550d537f6) Thanks [@ajshovon](https://github.com/ajshovon)! - Fix missing tini executable in Docker image

## 3.12.0

### Minor Changes

- [#69](https://github.com/alexbudure/queuedash/pull/69) [`6c61759`](https://github.com/alexbudure/queuedash/commit/6c61759906ab0923ea51c4e99ce5857b9da918af) Thanks [@gcleaves](https://github.com/gcleaves)! - fix completed tile in metrics

## 3.11.0

### Minor Changes

- [#66](https://github.com/alexbudure/queuedash/pull/66) [`b83a399`](https://github.com/alexbudure/queuedash/commit/b83a3991a50c00c17c992c50f4297a5986978725) Thanks [@alexbudure](https://github.com/alexbudure)! - Fix api imports

## 3.10.0

### Minor Changes

- [#63](https://github.com/alexbudure/queuedash/pull/63) [`e72a16b`](https://github.com/alexbudure/queuedash/commit/e72a16b0bbc405b720d8a93be6bf27043ca9fe59) Thanks [@alexbudure](https://github.com/alexbudure)! - Add metrics

## 3.9.0

### Minor Changes

- [#61](https://github.com/alexbudure/queuedash/pull/61) [`1626a08`](https://github.com/alexbudure/queuedash/commit/1626a08d5216544e2cd678056eda22ecc361913d) Thanks [@alexbudure](https://github.com/alexbudure)! - Adapter pattern, dark mode polish, and more tests

## 3.8.0

### Minor Changes

- [#58](https://github.com/alexbudure/queuedash/pull/58) [`f0b8299`](https://github.com/alexbudure/queuedash/commit/f0b82992985054cf343540d6b37cfd4e02eaa9cc) Thanks [@alexbudure](https://github.com/alexbudure)! - Add groupmq support

## 3.7.0

### Minor Changes

- [#56](https://github.com/alexbudure/queuedash/pull/56) [`f4917f6`](https://github.com/alexbudure/queuedash/commit/f4917f64ecc70965c7ba1e39347677e206817fb0) Thanks [@alexbudure](https://github.com/alexbudure)! - Add job scheduler ui, new "waiting-children" tab, and Docker support

## 3.6.0

### Minor Changes

- [#50](https://github.com/alexbudure/queuedash/pull/50) [`1fd1326`](https://github.com/alexbudure/queuedash/commit/1fd1326ebc22045c78ecdbbceef2856fcce6cbb6) Thanks [@alexbudure](https://github.com/alexbudure)! - - Job scheduler support
  - Per-job logs
  - Global pause & resume

## 3.5.0

### Minor Changes

- [#44](https://github.com/alexbudure/queuedash/pull/44) [`ba73bcf`](https://github.com/alexbudure/queuedash/commit/ba73bcf1afec112e6916a4c6beb132a8d9c7edd4) Thanks [@huv1k](https://github.com/huv1k)! - Add support for hono

## 3.4.0

### Minor Changes

- [#40](https://github.com/alexbudure/queuedash/pull/40) [`0ccd37a`](https://github.com/alexbudure/queuedash/commit/0ccd37afe5a3d8b158109d1ec80a02cead1480bf) Thanks [@fukouda](https://github.com/fukouda)! - Add the ability to pass in hook handlers on Fastify

## 3.3.0

### Minor Changes

- [#38](https://github.com/alexbudure/queuedash/pull/38) [`00346f4`](https://github.com/alexbudure/queuedash/commit/00346f4c11fdae742dae1981061f044aee66697b) Thanks [@alexbudure](https://github.com/alexbudure)! - Improve React 19 compatibility

## 3.2.0

### Minor Changes

- [`8e5c7ac`](https://github.com/alexbudure/queuedash/commit/8e5c7ac06bb13674e32b4cd9b1b7c65913e122af) Thanks [@alexbudure](https://github.com/alexbudure)! - Fix importing API

## 3.1.0

### Minor Changes

- [#33](https://github.com/alexbudure/queuedash/pull/33) [`011ad3b`](https://github.com/alexbudure/queuedash/commit/011ad3bca2b50b4568fa7edc7bf314948e84eeb9) Thanks [@alexbudure](https://github.com/alexbudure)! - Fix bundle strategy for API

## 3.0.0

### Major Changes

- [#21](https://github.com/alexbudure/queuedash/pull/21) [`6692303`](https://github.com/alexbudure/queuedash/commit/6692303bde835b9934e2ae962e4727357f0d4afe) Thanks [@alexbudure](https://github.com/alexbudure)! - This version upgrades core dependencies to their latest major versions, including Elysia, BullMQ, and tRPC

## 2.1.1

### Patch Changes

- [#26](https://github.com/alexbudure/queuedash/pull/26) [`2e0956c`](https://github.com/alexbudure/queuedash/commit/2e0956c586b9f5f3190f169e363f76230d037686) Thanks [@p3drosola](https://github.com/p3drosola)! - Improve UI support for long job ids

## 2.1.0

### Minor Changes

- [#23](https://github.com/alexbudure/queuedash/pull/23) [`7a2e3c0`](https://github.com/alexbudure/queuedash/commit/7a2e3c000da0b34c4c3a4dd2471e2e19738d1e6d) Thanks [@alexbudure](https://github.com/alexbudure)! - Fix bull api differences

## 2.0.5

### Patch Changes

- [`bc47dd5`](https://github.com/alexbudure/queuedash/commit/bc47dd5de7a5ed32cd82365dc27073282afc45be) Thanks [@alexbudure](https://github.com/alexbudure)! - Fix express bundling with app

## 2.0.4

### Patch Changes

- [`0948ec2`](https://github.com/alexbudure/queuedash/commit/0948ec21985d33b3ffbb0ec220664493382579da) Thanks [@alexbudure](https://github.com/alexbudure)! - Move html into each adapter

## 2.0.3

### Patch Changes

- [`dee7163`](https://github.com/alexbudure/queuedash/commit/dee71633d33c8bceee9bde84a0b340f899adeaf8) Thanks [@alexbudure](https://github.com/alexbudure)! - Remove unnecessary express app in adapter

## 2.0.2

### Patch Changes

- [`6680a6a`](https://github.com/alexbudure/queuedash/commit/6680a6a5ece43fef248fedacb31f8fae2242d2d3) Thanks [@alexbudure](https://github.com/alexbudure)! - Fix the adapters.. again

## 2.0.1

### Patch Changes

- [`8d2eadd`](https://github.com/alexbudure/queuedash/commit/8d2eadd9ad547ff2e893662474a228bf340f0728) Thanks [@alexbudure](https://github.com/alexbudure)! - Fix the middlewares for Fastify and Express

## 2.0.0

### Major Changes

- [#5](https://github.com/alexbudure/queuedash/pull/5) [`1f794d1`](https://github.com/alexbudure/queuedash/commit/1f794d1679225718dcc670e9c7eb59564fee1bc6) Thanks [@alexbudure](https://github.com/alexbudure)! - Updated all adapters to use a more natural API and added real-time Redis info on the queue detail page

  ***

  ### Breaking changes

  **Express**

  Before:

  ```typescript
  createQueueDashExpressMiddleware({
    app,
    baseUrl: "/queuedash",
    ctx: {
      queues: [
        {
          queue: new Bull("report-queue"),
          displayName: "Reports",
          type: "bull" as const,
        },
      ],
    },
  });
  ```

  After:

  ```typescript
  app.use(
    "/queuedash",
    createQueueDashExpressMiddleware({
      ctx: {
        queues: [
          {
            queue: new Bull("report-queue"),
            displayName: "Reports",
            type: "bull" as const,
          },
        ],
      },
    })
  );
  ```

  **Fastify**

  Before:

  ```typescript
  createQueueDashFastifyMiddleware({
    server,
    baseUrl: "/queuedash",
    ctx: {
      queues: [
        {
          queue: new Bull("report-queue"),
          displayName: "Reports",
          type: "bull" as const,
        },
      ],
    },
  });
  ```

  After:

  ```typescript
  server.register(fastifyQueueDashPlugin, {
    baseUrl: "/queuedash",
    ctx: {
      queues: [
        {
          queue: new Bull("report-queue"),
          displayName: "Reports",
          type: "bull" as const,
        },
      ],
    },
  });
  ```

## 1.2.1

### Patch Changes

- [#12](https://github.com/alexbudure/queuedash/pull/12) [`d79c8ff`](https://github.com/alexbudure/queuedash/commit/d79c8ffe34ae36c74d0663dd2e29e6c93327bf8c) Thanks [@alexbudure](https://github.com/alexbudure)! - Fix Elysia plugin

## 1.2.0

### Minor Changes

- [`9aaec9a`](https://github.com/alexbudure/queuedash/commit/9aaec9a21c091680cb30a67e9322eedd3e16dbe8) Thanks [@alexbudure](https://github.com/alexbudure)! - Support for Elysia

## 1.1.0

### Minor Changes

- [#7](https://github.com/alexbudure/queuedash/pull/7) [`885aee3`](https://github.com/alexbudure/queuedash/commit/885aee3cecac687d05f5b18cd1855fcb5522f899) Thanks [@alexbudure](https://github.com/alexbudure)! - Add support for prioritized jobs

## 1.0.1

### Patch Changes

- [#3](https://github.com/alexbudure/queuedash/pull/3) [`a385f9f`](https://github.com/alexbudure/queuedash/commit/a385f9f9e76df4cea8e69d7e218b65915acef3bf) Thanks [@alexbudure](https://github.com/alexbudure)! - Tighten adapter types to work with NestJS

## 1.0.0

### Major Changes

- [#1](https://github.com/alexbudure/queuedash/pull/1) [`c96b93d`](https://github.com/alexbudure/queuedash/commit/c96b93d9659bbb34248ab377e6659ebfb1fc3dd8) Thanks [@alexbudure](https://github.com/alexbudure)! - QueueDash v1 🎉
  - 😍&nbsp; Simple, clean, and compact UI
  - 🧙&nbsp; Add jobs to your queue with ease
  - 🪄&nbsp; Retry, remove, and more convenient actions for your jobs
  - 📊&nbsp; Stats for job counts, job durations, and job wait times
  - ✨&nbsp; Top-level overview page of all queues
  - 🔋&nbsp; Integrates with Next.js, Express.js, and Fastify
  - ⚡️&nbsp; Compatible with Bull, BullMQ, and Bee-Queue
