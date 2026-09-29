---
"@queuedash/api": minor
"@queuedash/client": minor
"@queuedash/ui": minor
---

Add job has a name field now (BullMQ and Bull), with the names the queue already uses one click away. ⌘↵ (Ctrl+↵) adds from anywhere in the panel, and Add another keeps it open for the next one.

Rerun is now Duplicate: it opens Add job filled in from the job and marks what you changed. Add it untouched and it keeps the original's real data, even the parts the dashboard redacts. Bulk Rerun is still there.

API: `queue.addJob` takes an optional `name` (not on Bee-Queue or GroupMQ). Jobs have `rawName`, the name before any `jobName` display mapping.
