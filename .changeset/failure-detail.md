---
"@queuedash/api": minor
"@queuedash/client": minor
"@queuedash/ui": minor
---

A failed job's panel now says what went wrong, where, and whether it's only this job. The failure card leads with the error type and message, the first line of your own code in the trace, and how many jobs failed with the same error in the last 24 hours, linked to that group in the Errors tab. A new Attempts section lists every attempt the library kept a trace of, newest first, with library frames (node_modules, Node internals) folded away. BullMQ jobs also show which named worker ran them, whether it's still connected, and how often they stalled, with what a stall means.

Stack frames open in your editor: VS Code, Cursor, Windsurf, Zed, WebStorm, IntelliJ IDEA or a custom URL. The first time you open one, the panel asks for your editor and where the workers' paths live on your machine (`/app` → `/Users/you/code/app`). It's saved in your browser, and Settings › Code links changes it.

For API users: `job.byId` returns `errorFingerprint`, the job's error group. BullMQ jobs carry `processedBy`, `attemptsStarted` and `stalledCounter`. Bee-Queue stack traces now come oldest first, like every other library's.
