---
"@queuedash/api": minor
"@queuedash/client": minor
"@queuedash/ui": minor
---

Fix a job's data in place. Job data has an Edit button, and a failed job gets Save and retry, which runs that same job again with the new data instead of adding a copy. That's what gets a stuck flow moving, since its parent waits on the job's id. BullMQ and Bull, and off while the server redacts or hides job data.

API: `job.updateData` saves data onto a job, and retries it with `retry: true`. `queue.byName` reports it in `supports.updateData`. New access action: `job.update`.
