# ROADMAP

Actionable work only. Historical and completed roadmap material is archived in CHANGELOG.md; blocked work is kept in Roadmap_Blocked.md.

## Actionable Items

- [ ] Export user filters as a shareable JSON with per-rule notes

- [ ] Per-site enable/disable of user filters

- [ ] Auto-disable filters that match zero elements for 30 days (stale filter cleanup)

- [ ] Import from AdGuard / ABP / uBlock-Origin-Lite cosmetic syntax with a compatibility note for procedurals that can't cross over

- [ ] Theme palette object (Catppuccin Latte/Frappe/Macchiato/Mocha swappable)

- [ ] CSP-compatible mode for sites that reject inline-injected filters

- [ ] P2 — Element Probe panel i18n
  Why: 72 locale directories exist with translations for all uBO UI, but Element Probe panel text is hardcoded English in HTML and JS. Only the context menu entry ("Inspect with Element Probe") uses i18n.
  Evidence: `src/_locales/en/messages.json` — only `contextMenuElementProbe` string for Element Probe. All panel text (`src/element-probe-panel.html`, `src/js/element-probe-panel.js`) is hardcoded.
  Touches: `src/_locales/en/messages.json` (new keys), `src/element-probe-panel.html` (mustache placeholders), `src/js/element-probe-panel.js` (status/log messages)
  Acceptance: Element Probe panel renders correctly in at least 3 non-English locales. All user-visible strings use i18n keys.
  Complexity: L

- [ ] P2 — Modularize `element-probe-panel.js`
  Why: 1822-line single IIFE containing all panel logic — inspection, UI rendering, event handling, history, picker, frame targeting. Adding new procedural operators or features requires modifying a monolithic file.
  Evidence: `wc -l src/js/element-probe-panel.js` = 1822 lines.
  Touches: `src/js/element-probe-panel.js` → split into `src/js/element-probe/inspect.js`, `src/js/element-probe/ui.js`, `src/js/element-probe/history.js`, `src/js/element-probe/picker.js`, `src/js/element-probe/frames.js`
  Acceptance: Panel behavior is identical; each module is <400 lines; new operators can be added by editing only `inspect.js`.
  Complexity: L

- [ ] P2 — Filter list update diff view in dashboard
  Why: When subscribed filter lists update, users can't see what changed. Debugging breakage from list updates is trial-and-error. This is distinct from the existing "Side-panel diff" nice-to-have (which is about site DOM changes).
  Evidence: Community research — filter list management pain point. No diff UI exists in uBO or any competitor.
  Touches: `src/js/3p-filters.js`, `src/3p-filters.html`, `src/css/3p-filters.css`
  Acceptance: After a filter list updates, a "View changes" link shows added/removed/modified rules since the previous version.
  Complexity: L

- [ ] P2 — Resizable logger columns
  Why: Upstream declined this request (uBlock-issues #853, 4 thumbs-up). Logger columns are fixed-width, making it hard to read long URLs or filter expressions. A differentiator the fork can implement that upstream won't.
  Evidence: https://github.com/uBlockOrigin/uBlock-issues/issues/853 — declined by gorhill.
  Touches: `src/js/logger-ui.js`, `src/css/logger-ui.css`
  Acceptance: Logger columns are draggable-resizable. Column widths persist across sessions via `chrome.storage.local`.
  Complexity: M
