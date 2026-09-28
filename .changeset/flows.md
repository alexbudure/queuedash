---
"@queuedash/api": minor
"@queuedash/client": minor
"@queuedash/ui": minor
---

BullMQ flows are now first-class. A job that belongs to a flow gets a Flow section in its panel: its parent, its children by status, and the ones that need attention first. Open flow shows the whole flow, across queues, on one timeline: how long each job waited and ran, what the parent is still waiting on, and the failed job holding it up, with Retry for every failure in the flow. Large flows load 50 children per job, with Show more. Children in queues you can't see are counted, never named.

For API users: `flow.links` returns a job's parent and first children, and `flow.tree` the whole flow from its topmost visible ancestor. Both are unavailable while job ids are redacted.
