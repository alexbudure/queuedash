---
"@queuedash/api": patch
"@queuedash/client": patch
"@queuedash/ui": patch
---

Fonts ship inside `@queuedash/ui` instead of loading from Google Fonts, so viewers' IPs stop going to Google and the fonts work offline and under a strict CSP. Same Inter and JetBrains Mono, loaded from `dist/fonts/`, only the subsets a page needs. They use Queuedash-specific family names, so your app's own Inter is left alone.
