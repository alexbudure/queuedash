---
"@queuedash/api": minor
"@queuedash/client": minor
"@queuedash/ui": minor
---

New Job types tab: every kind of job in a queue, by name, with how often it ran, how often it failed, p50 and p95 run times and when it last ran. Click one for its jobs over the same window. BullMQ and Bull, from the finished jobs the queue still keeps.

API: `job.types` returns them for the last `minutes`. `job.list` and the by-filter bulk actions take a job `name`.
