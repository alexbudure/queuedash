---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

The dashboard's fonts ship with `@queuedash/ui` instead of loading from Google Fonts. Every page load used to send the viewer's IP address to Google, including in apps that embed the dashboard, and the fonts failed offline or behind a strict content security policy. The same Inter and JetBrains Mono files now load from `dist/fonts/` next to the stylesheet, and only the subsets a page needs are downloaded. They use Queuedash-specific family names, so an app's own Inter is left alone.
