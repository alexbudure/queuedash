---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

The dashboard script that the Express, Fastify, Hono and Elysia integrations load is fully minified: 1.3 MB instead of 1.8 MB, and 384 KB instead of 452 KB gzipped. `@queuedash/client` also stops shipping a CommonJS copy that nothing loaded, and no longer installs React, which its bundle already contains.
