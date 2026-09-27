# `@queuedash/client`

The prebuilt browser entrypoint used by Queuedash's Express, Fastify, Hono, and
Elysia server integrations.

[![NPM version](https://img.shields.io/npm/v/@queuedash/client.svg?style=flat-square)](https://www.npmjs.com/package/@queuedash/client)
[![MIT license](https://img.shields.io/npm/l/@queuedash/client.svg?style=flat-square)](https://github.com/alexbudure/queuedash/blob/main/LICENSE)

Most applications should not import this package directly.

- Use [`@queuedash/api`](https://www.npmjs.com/package/@queuedash/api) for
  server adapters, queue configuration, discovery, privacy, and access policy.
- Use [`@queuedash/ui`](https://www.npmjs.com/package/@queuedash/ui) for Next.js
  or direct React embedding.

The server adapters render a small HTML bootstrap containing the API URL,
router base path, browser-safe UI configuration, and optional session-auth
endpoint. `@queuedash/client` reads that state and mounts `QueuedashApp` into
the page. Credentials and signed sessions are never serialized into the
bootstrap.

The API, client, and UI packages are versioned together. Do not mix client
bundle versions manually.

See the [main Queuedash documentation](https://github.com/alexbudure/queuedash)
for installation and configuration.
