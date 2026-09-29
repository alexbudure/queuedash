---
"@queuedash/api": minor
"@queuedash/client": minor
"@queuedash/ui": minor
---

A failed job's panel shows what broke and where. The error card has the type, the message, the line of your code that threw, and how many other jobs hit the same error in the last day, linked to its Errors group. A new Attempts section lists every attempt that kept a stack trace, newest first, with node_modules and Node internals folded away. BullMQ jobs also show which worker ran them, whether it's still connected, and how often they stalled.

Stack frames open in your editor: VS Code, Cursor, Windsurf, Zed, WebStorm, IntelliJ IDEA or a custom URL. The first time, it asks for your editor and how the workers' paths map to yours (`/app` → `/Users/you/code/app`). That's saved in your browser; change it in Settings › Code links.

API: `job.byId` returns `errorFingerprint`. BullMQ jobs have `processedBy`, `attemptsStarted` and `stalledCounter`. Bee-Queue stack traces are oldest first now, like everyone else's.
