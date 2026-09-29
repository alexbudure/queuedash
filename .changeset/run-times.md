---
"@queuedash/api": minor
"@queuedash/client": minor
"@queuedash/ui": minor
---

The Health strip shows run times: p50 and p95 for jobs that finished in the selected range, with a sparkline of the median. Like the rest of the strip, it counts whole minutes and only the completed jobs the queue still keeps. With five cells in a row, sparklines now show on screens 1536px and wider.

API: `job.runTimes` returns a queue's p50 and p95 over the last `minutes`. Bee-Queue doesn't record start times, so it has none.
