---
"@queuedash/api": minor
"@queuedash/client": minor
"@queuedash/ui": minor
---

The queue page's Health strip shows how long jobs take to run: the median (p50) and the slow tail (p95) of the jobs that completed in the chosen range, read from their start and finish times, with how the median moved across the range. Like the other counts in the strip it covers whole minutes, and it covers the completed jobs the queue still keeps. With five cells to a row, the strip's sparklines now appear on screens 1536px and wider.

For API users: `job.runTimes` returns a queue's p50 and p95 run times over the last `minutes`. Bee-Queue records no start time, so it has none to report.
