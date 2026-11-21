# pages-moved

What GitHub Pages serves at ocscanner.github.io/IntelHQ after IntelHQ moved to https://hq.ocscanner.media (P05).

- `index.html`, `hq.html`, `404.html`: the same "IntelHQ has moved" page. It forwards to the same page and tab at hq.ocscanner.media after 4 seconds (e.g. `/IntelHQ/hq.html#radar` → `hq.ocscanner.media/hq.html#radar`).
- `sw.js`: replaces the old offline cache. Browsers that had the old app installed delete its saved copy and stop using it.
- No IntelHQ code or data is served from here.

Turn on: Settings → Pages → Source: branch `pages-moved`, folder `/ (root)`.
Turn off later (about a week after the move): Settings → Pages → Unpublish.
Undo: point Pages back at `main`.
