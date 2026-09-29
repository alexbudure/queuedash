---
"@queuedash/api": minor
"@queuedash/client": minor
"@queuedash/ui": minor
---

Jobs in a BullMQ flow get a Flow section in their panel: the parent, the children by status, and which ones need a look. Open flow shows the whole flow across queues on one timeline: what waited, what ran, what the parent is still waiting on, and the failure holding it up, with Retry for every failed job in it. Big flows load 50 children at a time. Children in queues you can't see are counted, never named.

API: `flow.links` returns a job's parent and first children, and `flow.tree` the whole flow from its top visible ancestor. Neither works while job ids are redacted.
