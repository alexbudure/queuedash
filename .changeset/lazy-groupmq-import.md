---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

`@queuedash/api` 4.0.0 failed to load unless `groupmq` was installed, so apps that don't use GroupMQ crashed at startup with `Cannot find module 'groupmq'`. It now loads GroupMQ only when a GroupMQ queue needs it.

In Next.js, also add `@queuedash/api` to `serverExternalPackages` in `next.config`. Next bundles route handlers, and its bundler fails on each queue library Queuedash loads on demand that you haven't installed. The README and example show the setting.
