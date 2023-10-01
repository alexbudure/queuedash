# @queuedash/client

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
