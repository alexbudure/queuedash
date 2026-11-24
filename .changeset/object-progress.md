---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

Job progress shows up when a worker reports an object, like `job.updateProgress({ step: "billing" })` (#117). Numbers still draw the bar, and anything else shows as JSON in the job details, next to the data. It's hidden along with job data or return values.

API: a job's `progress` is whatever the worker reported, not only a number.
