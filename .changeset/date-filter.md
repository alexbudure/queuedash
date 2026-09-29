---
"@queuedash/api": minor
"@queuedash/client": minor
"@queuedash/ui": minor
---

Filter the job list by date: Last 15 minutes up to Last 7 days, or any range. On a phone it's a sheet that tells you how many jobs you'll get. Finished jobs go by when they finished, delayed ones by when they're due, and the rest by when they were added. It stacks with the other filters, Retry all and Remove all act on exactly what's listed, and the range goes in the URL. For finished jobs on BullMQ and Bull it's one Redis call with an exact count, no scan limit.

API: `job.list` and the by-filter bulk actions take `from` and `to` (ms), or `fromOffset` and `toOffset` relative to when the request runs. Delayed jobs have `runAt`.
