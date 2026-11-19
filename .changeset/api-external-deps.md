---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

The API no longer bundles its own zod and tRPC. It uses the copies your app installs, so `npm audit` sees them (#115). redis-info is gone too, and lodash with it: reading Redis INFO takes a few lines now. zod needs 4.6.6 or newer, which fixes a memory exhaustion advisory. The Elysia and Hono adapters still bundle their framework, now on patched versions. The API bundle is about a quarter smaller, and the dashboard's dependencies are refreshed too.
