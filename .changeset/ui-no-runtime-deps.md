---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

Installing `@queuedash/ui` no longer pulls in about 400 MB of packages. It listed 21 dependencies that its build already bundles or never loads, such as `monaco-editor`. It now needs only the React and React DOM your app already has. The Docker image sheds about 270 MB for the same reason.

Closing the Add job dialog just as its JSON editor appears no longer logs `Uncaught (in promise) Canceled: Canceled` in the browser console.
