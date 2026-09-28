---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

Add `rejectNonJsonPost` for tRPC handlers you serve yourself, such as a Next.js route. It returns the `415` the built-in adapters send for a `POST` that isn't `application/json`, or `undefined` when the request can go on to tRPC.

The 4.0.0 Next.js README and example left this check out. If you copied that route, call `rejectNonJsonPost` before `fetchRequestHandler`, as the README now shows. Otherwise a plain form on another website can pause or resume your queues.
