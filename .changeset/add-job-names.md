---
"@queuedash/api": minor
"@queuedash/client": minor
"@queuedash/ui": minor
---

Add job takes a name, for queues whose jobs have one (BullMQ and Bull), with the names this queue already uses one click away: workers often pick a handler by name. <kbd>⌘</kbd> <kbd>↵</kbd> (<kbd>Ctrl</kbd> <kbd>↵</kbd> elsewhere) adds from anywhere in the panel, and Add another keeps the panel open with its values, for adding test jobs one after another.

Rerun in the job panel is now Duplicate: it opens Add job filled in from the job, with every line you change marked and Reset to go back. Added unedited, it's the same as Rerun and keeps the original's real data even where this dashboard shows it redacted. Bulk Rerun for completed jobs stays.

For API users: `queue.addJob` takes an optional `name`, rejected for Bee-Queue and GroupMQ, whose jobs have none. Jobs carry `rawName`, the name they were added under before a `jobName` display mapping.
