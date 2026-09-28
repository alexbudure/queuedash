---
"@queuedash/api": minor
"@queuedash/client": minor
"@queuedash/ui": minor
---

A new Errors tab groups a queue's failed jobs by what went wrong. A group is the error's type, its message with ids, numbers, emails and other parts that vary masked out, and the first line of your own code in its stack trace. Each group shows how many jobs it holds, its failures per hour over the last day, and when it was first and last seen. Opening a group lists its jobs, with Retry all and Remove all for exactly those jobs. It works for Bull, BullMQ, Bee-Queue and GroupMQ, groups only what the viewer is allowed to see after redaction, and says plainly that it covers only the failed jobs Redis still keeps.

For API users: `job.errorGroups` returns the groups, and `job.list`, `job.bulkRetryByFilter` and `job.bulkRemoveByFilter` take a group's fingerprint as `error`.
