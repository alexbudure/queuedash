---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

Toasts look right again. The dashboard's CSS reset was overriding their styles, so they showed up as cramped strips with no padding and a heavy black icon. They now match menus and popovers in light and dark and stay clear of the panel's corner.

The "Discard your changes?" toast you get when closing Add job with unsaved edits is clickable again. The open panel was making everything outside it inert, toast included.
