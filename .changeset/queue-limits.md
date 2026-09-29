---
"@queuedash/api": minor
"@queuedash/client": minor
"@queuedash/ui": minor
---

Set a queue's global concurrency and rate limit from the Workers panel. They're stored in Redis, so every worker follows them. While the queue is rate limited, the Workers cell says so with the time left, and Clear now ends the window early. BullMQ only.

API: `queue.limits`, `queue.setConcurrency`, `queue.setRateLimit` and `queue.clearRateLimit`, each with its access action.
