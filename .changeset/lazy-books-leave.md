---
"@queuedash/client": major
"@queuedash/api": major
"@queuedash/ui": major
---

Updated all adapters to use a more natural API and added real-time Redis info on the queue detail page

---

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
