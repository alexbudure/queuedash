---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

A round of small fixes. Row checkboxes always show on touch screens, which also lose the ⌘K and ⌘↵ hints. The queue's subtitle wraps before a "·", never after. Empty lists don't get a bulk bar, and a "—" doesn't get a trend arrow. A masked "(size)" in an error stays with its brackets, and long job ids in the table shorten to 8 characters. The bulk bar says Retry all and Remove all.
