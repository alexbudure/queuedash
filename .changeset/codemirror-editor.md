---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

The JSON editors are CodeMirror now, bundled in. No more pulling Monaco (about 1 MB) from jsdelivr every time one opens, so they work offline, and they match each dashboard's light or dark theme. The client gets about 120 KB gzipped bigger.
