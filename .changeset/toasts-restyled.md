---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

Toasts look like the rest of the dashboard again. The dashboard's scoped CSS reset outranked the toast library's own styles, so every notification rendered as a cramped strip with no padding or border and a heavy black icon. They now use the same surface as menus and popovers in light and dark, with the status icons from the job list, and sit clear of the page panel's corner.

The "Discard your changes?" toast that appears when you close Add job with unsaved edits can be clicked again. The open panel made everything outside it inert, including the toast, so Discard did nothing.
