---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

The Health strip's Workers cell no longer says a busy worker was "last seen" minutes ago. That time came from Redis: how long the connection a worker waits on has gone unused, and a worker with a steady stream of jobs never needs to wait, so the busier it was, the longer ago it seemed to have been seen. The cell now says what the queue's workers are doing, from its jobs: "1 active job", "3 active jobs", or "idle". The Workers panel shows how long each worker has been connected instead of its idle time.
