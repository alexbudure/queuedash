---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

Installing `@queuedash/ui` no longer drags in about 400 MB of packages. It listed 21 dependencies its build already bundles or never uses, like `monaco-editor`; now it only needs the React and React DOM you already have. The Docker image is about 270 MB lighter for the same reason.
