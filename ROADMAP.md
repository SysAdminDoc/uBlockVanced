# ROADMAP

uBlockForge (v0.3.0, branded "uBlockVanced" in-repo) is an MV2 uBlock Origin fork with a DevTools panel ("Element Probe") for deep element inspection, procedural cosmetic filter generation, Catppuccin Mocha theme, and YouTube-specific selector tooling.

## Planned Features

### Element Probe

### Filter management
- Filter history with one-click undo (already exists) expanded to a searchable filter-log panel
- Export user filters as a shareable JSON with per-rule notes
- Per-site enable/disable of user filters
- Auto-disable filters that match zero elements for 30 days (stale filter cleanup)
- Import from AdGuard / ABP / uBlock-Origin-Lite cosmetic syntax with a compatibility note for procedurals that can't cross over

### Theme
- Theme palette object (Catppuccin Latte/Frappe/Macchiato/Mocha swappable)

### Safety
- CSP-compatible mode for sites that reject inline-injected filters

## Competitive Research

- **uBlock Origin (upstream)** — The ground truth. uBO has the smartest dev team in the space; don't out-feature, differentiate on tooling
- **uBlock Origin Lite (MV3)** — The official MV3 successor; uBlockForge needs a story for when MV2 sunsets in Chrome stable
- **AdGuard DevTools Assistant** — Commercial DevTools panel for ad-blocker rule authoring; direct competitor to Element Probe
- **Cosmetic Filters Toolkit (uBO wiki)** — Community docs; pull their examples into the Element Probe help pane

## Nice-to-Haves

- Built-in recorder that captures page interaction and suggests filters for elements that appear mid-flow (infinite-scroll injections)
- Side-panel diff when a site's DOM changes (before/after markup) to speed up filter repair after site redesigns
- YouTube-specific "sweep" mode that one-shots the current known ad container set and reports which are present
- Shareable permalinks to a specific filter draft for collaborative filter authoring

## Open-Source Research (Round 2)

### Related OSS Projects
- https://github.com/gorhill/uBlock — upstream uBlock Origin (MV2 reference implementation, procedural engine source of truth)
- https://github.com/uBlockOrigin/uBlock-issues — canonical issue tracker + procedural filter wiki
- https://github.com/AdguardTeam/AdguardFilters — AdGuard filter repo, syntax divergences worth tracking (`{ remove: true; }`, `$$`)
- https://github.com/AdguardTeam/AdguardBrowserExtension — reference MV2+MV3 dual-manifest build pipeline
- https://github.com/ghostery/adblocker — TypeScript adblocker engine with a published compatibility matrix
- https://github.com/ghostery/adblocker/wiki/Compatibility-Matrix — ground-truth operator support across uBO/ABP/AdGuard/Brave
- https://github.com/NanoAdblocker/NanoFilters — Nano-specific snippet filters, ideas for `+js(...)` scriptlets
- https://github.com/brave/adblock-rust — Rust adblock engine (useful for perf/AST ideas even if not directly portable)
- https://gist.github.com/unixzii/37369baa7996cdc8dd459c267785603b — fuck-x userscript with aggressive X/Twitter element rules to stress-test Element Probe
- https://github.com/hoblin/x-ad-banhammer — advertiser-auto-block userscript, interesting complement filter flow

### Features to Borrow
- Scriptlet injection (`+js(...)`) pipeline for page-world patches, with a vetted scriptlet library — NanoFilters + uBO scriptlets folder
- Depth/specificity dual-slider in the generated-filter modal — uBO element picker UI
- Hostname auto-prefix guard (discard generic procedural filters at parse time) — uBO engine invariant

### Patterns & Architectures Worth Studying
- Static filter AST → compiled procedural pipeline in uBO's `cosmeticFilteringEngine.js` (build once, run many)
- Shadow DOM piercing strategy: uBO's late-injected content script walks open shadow roots via `element.shadowRoot` recursion with a WeakSet to avoid infinite loops — port to Element Probe for YouTube chat banner selection
- `chrome.devtools.inspectedWindow.eval()` + `useContentScriptContext: true` split between DevTools page and target tab — already used; cross-check against AdGuard DevTools assistant for idle-connection handling
- Procedural filter quote-escaping rules (`\'`, `\"`, `\`) — must match uBO exactly or filter imports will silently drift
- Test-runner pattern from `ghostery/adblocker`: snapshot-based filter-output tests against real-world HTML fixtures — adopt for regression coverage as operator set grows

## Implementation Deep Dive (Round 3)

### Reference Implementations to Study
- **gorhill/uBlock / src/js/static-net-filtering.js** — https://github.com/gorhill/uBlock — the static-filter compiler; reference for converting ABP-syntax filters into a trie + bitmap lookup structure.
- **uBlockOrigin/uBOL-home** — https://github.com/uBlockOrigin/uBOL-home — the MV3 fork; authoritative example of compiling ABP syntax to declarativeNetRequest rulesets at build time (not runtime).
- **gorhill/uBlock commit a559f5f ("Add experimental mv3 version")** — https://github.com/gorhill/uBlock/commit/a559f5f2715c58fea4de09330cf3d06194ccc897 — first MV3 attempt ("uBO Minus"); documents what couldn't be ported (no `##`, no `##+js`, no `redirect=`, no `csp=`, no `removeparam=`).
- **DeepWiki: uBOL MV3 architecture** — https://deepwiki.com/gorhill/uBlock/8-ublock-origin-lite-(mv3) — layered permissions model (basic/optimal/complete) mapped to `<all_urls>` vs. `activeTab` vs. per-site; directly applicable to our UX.
- **gorhill/uBlock/wiki/Static-filter-syntax** — https://github.com/gorhill/uBlock/wiki/Static-filter-syntax — ABP syntax + uBO extensions; authoritative.
- **AdguardTeam/AdguardBrowserExtension** — https://github.com/AdguardTeam/AdguardBrowserExtension — alternative MV3 implementation; compare their DNR rule generator to uBOL's for ideas.
- **EasyList / EasyPrivacy / Peter Lowe's** — https://easylist.to — default ruleset sources; our build pipeline must fetch, diff, and recompile on list updates.

### Known Pitfalls from Similar Projects
- **30K dynamic rule cap** (Chrome's DNR limit per extension; 330K across all extensions) — uBOL pre-compiles into static rulesets (bigger, free), and reserves dynamic slots for per-user custom filters. Plan: 3-4 static rulesets by filter-list category, dynamic slots for user rules only. Ref: https://github.com/uBlockOrigin/uBOL-home/wiki/Frequently-asked-questions-(FAQ)
- **No cosmetic filtering via DNR** — `##` hiding requires content scripts injected via `chrome.scripting`; uBOL ships a separate cosmetic filter compiler. Can't ship one or the other — need both.
- **No live filter-list updates without extension update** — the MV3 model requires new list content to ship as a new extension version. Set expectation in README or implement as `dynamic_rules` with quotas.
- **Firefox DNR is slow** — Firefox's implementation is JS-based and un-optimized (bugzilla 1745768); ship MV2 blocking-webRequest for Firefox as long as they permit it.
- **`removeparam=` / `csp=` / `redirect=` not fully supported in MV3** — `removeparam` now via DNR `queryTransform`; `csp` via `modifyHeaders` action; `redirect` only for extension-bundled resources. Ref: https://github.com/gorhill/uBlock/wiki/Static-filter-syntax
- **`urlskip=`** trusted-source only under MV3 — can't be enabled from untrusted user lists. Document as a limitation.
- **"Browser-launch filtering"** — MV3 actually wins here for static rules; they apply before our SW starts. Make this visible in the popup so users understand the tradeoff.

### Library Integration Checklist
- **chrome.declarativeNetRequest** MV3; entrypoint `chrome.declarativeNetRequest.updateEnabledRulesets` / `updateDynamicRules`; gotcha: static rulesets counted against 330K cap; 5K dynamic cap; 30K per-extension (Chrome 120+ raised this).
- **chrome.scripting.executeScript** (cosmetic filtering); entrypoint `world:"ISOLATED"`; gotcha: need `host_permissions` or `activeTab`; bulk `registerContentScripts` for static cosmetic rules.
- **abp-filter-parser / @adblockplus/adblockpluscore** — pin latest; entrypoint build-time filter compiler; gotcha: not all uBO-extended syntax supported — layer a custom compiler on top.
- **esbuild** `>=0.25`; entrypoint `esbuild.build`; gotcha: ruleset JSON generation is a separate build step, not a bundler concern.
- **Node 20+ build script** — entrypoint `node scripts/compile-lists.mjs`; gotcha: must be deterministic (sort rules by id) so CI diffs are readable.
- **chrome.storage.local** for user custom filters; gotcha: 10MB quota, declare `unlimitedStorage` if we allow large custom lists.
- **ajv** pin `>=8.x` (ruleset schema validation); gotcha: uBOL's schema differs from Chrome's documented schema in a few fields — validate against Chrome's, not uBOL's.

## Research-Driven Additions

### P2 — Medium (quality, testing, DX improvements)

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

### P3 — Low (nice-to-have, future differentiation)

- [ ] P3 — Cookie consent auto-dismiss integration
  Why: Ghostery's Never-Consent and Brave's built-in consent handling auto-reject cookie banners. This is increasingly expected by privacy-focused users. The `@duckduckgo/autoconsent` library (MIT-licensed, 116 stars) provides ready-made rules for navigating consent popups.
  Evidence: Ghostery v10.5.40+ uses `@duckduckgo/autoconsent` v14.97.0. uBO has annoyance filter lists but no auto-dismiss logic.
  Touches: New content script integrating autoconsent library, settings toggle, `src/js/settings.js`
  Acceptance: Cookie consent banners are automatically dismissed (opt-out) on supported sites. User can enable/disable in settings.
  Complexity: L

- [ ] P3 — `content-visibility: hidden` as performance-optimized cosmetic hiding
  Why: `content-visibility: hidden` skips rendering (layout + paint) for hidden elements, potentially faster than `display: none !important` for pages with many cosmetic filter matches. Elements remain in DOM for JavaScript access but browsers skip expensive rendering work.
  Evidence: MDN `content-visibility` — Baseline since September 2024. Brave's cosmetic filtering uses two-phase approach (URL-specific at load, generic on discovery) suggesting performance matters at scale.
  Touches: `src/js/cosmetic-filtering.js`, `src/js/contentscript-extra.js`
  Acceptance: Option to use `content-visibility: hidden` instead of `display: none` for cosmetic filters. Measurable rendering performance improvement on heavy pages (100+ cosmetic matches).
  Complexity: M

- [ ] P3 — "Distractions" toggle UI for annoyance categories
  Why: Ghostery v10.5.44 introduced "Distractions" — toggle-based hiding for YouTube Shorts, Instagram/Facebook Reels, social share widgets, Google Sign-In popups. uBO has annoyance filter lists but no dedicated toggle UI. A category-based toggle is more discoverable than subscribing to filter lists.
  Evidence: Ghostery release notes v10.5.44. uBO ships EasyList Cookie, uBO Annoyances, AdGuard Annoyances as subscribable lists.
  Touches: `src/js/popup-fenix.js`, `src/popup-fenix.html`, `src/css/popup-fenix.css` (toggle section), `src/js/messaging.js` (list subscription management)
  Acceptance: Popup has toggles for annoyance categories (cookie banners, social widgets, newsletter popups, video autoplay). Each toggle subscribes/unsubscribes the corresponding filter list.
  Complexity: L

