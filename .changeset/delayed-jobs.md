---
"@queuedash/api": minor
"@queuedash/client": minor
"@queuedash/ui": minor
---

Delayed jobs show when they'll run, and you can move them: 5 minutes, an hour, tomorrow morning or any time, with how that compares to the plan. You can also change the priority of a job that hasn't started and release a deduplication id so new jobs with it get in. Promote is called Run now. BullMQ only, on versions that have the methods.

API: `job.changeDelay`, `job.changePriority` and `job.removeDeduplication`, each with its access action. Jobs have `deduplicationId`, and BullMQ jobs their current `priority`.
