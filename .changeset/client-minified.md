---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

The dashboard script the Express, Fastify, Hono and Elysia adapters load is fully minified now, about 30% smaller. `@queuedash/client` also drops a CommonJS build nothing used, and stops installing React, which it already bundles.
