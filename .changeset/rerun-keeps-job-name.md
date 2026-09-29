---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

Rerun keeps the job's name and run settings. It used to re-add only the data, as "Manual add" (unnamed on Bull), so workers that route by name couldn't handle it, and a job set to retry five times got one shot. Now it keeps attempts, backoff, priority, timeout, retention and the GroupMQ group, and drops the id, delay, schedule and flow parent, so it runs right away as a new job. `job.rerun` returns the new job.
