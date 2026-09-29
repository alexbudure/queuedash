---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

The Workers cell stops calling busy workers "last seen 15m ago". That number was Redis's idle time for the connection a worker waits on, which a busy worker never touches. It now shows what the workers are doing: "1 active job", "3 active jobs" or "idle". The Workers panel shows how long each worker has been connected instead.
