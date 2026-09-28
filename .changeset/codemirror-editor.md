---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

The JSON editors in Add job and Add scheduler are now CodeMirror, bundled with the package. Monaco came from jsdelivr at runtime, about 1 MB on every open; the editors now need no CDN and no web workers, so they work offline, and each dashboard mount's editors follow its own light or dark theme. The standalone client grows by about 120 KB gzipped.
