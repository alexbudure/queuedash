---
"@queuedash/api": minor
"@queuedash/client": minor
"@queuedash/ui": minor
---

New Errors tab: failed jobs grouped by what went wrong. A group is the error type, its message with ids and numbers masked out, and the first line of your own code in the trace. Each one shows its job count, failures per hour over the last day, and when it was first and last seen. Open one to see its jobs and retry or remove them all at once. Works on all four libraries, only groups what the viewer is allowed to see, and only covers failed jobs Redis still has.

API: `job.errorGroups` returns the groups. `job.list`, `job.bulkRetryByFilter` and `job.bulkRemoveByFilter` take a group's fingerprint as `error`.
