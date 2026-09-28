---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

Rerun adds the job again under its own name and with the settings that decide how it runs. It used to add only the job's data, named "Manual add" (unnamed on Bull), so a worker that dispatches on the job name couldn't process the rerun, and a job set to retry five times got a single attempt. A rerun now keeps the original's attempts, backoff, priority, timeout and retention settings, and on GroupMQ its group; it leaves out the job's id, delay, schedule and flow parent, so it runs now as a new job. `job.rerun` returns the new job rather than the original.
