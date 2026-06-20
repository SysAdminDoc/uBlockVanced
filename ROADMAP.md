# ROADMAP

uBlockForge (v0.2.6, branded "uBlockVanced" in-repo) is an MV2 uBlock Origin fork with a DevTools panel ("Element Probe") for deep element inspection, procedural cosmetic filter generation, Catppuccin Mocha theme, and YouTube-specific selector tooling.

## Planned Features

### Element Probe
- `:xpath()` procedural operator support in addition to the existing uBO procedurals
- Shadow-root-piercing selectors generated automatically when the picked element sits behind a closed shadow root (report unreachable instead of producing a silent no-match)
- "Test filter" button that temporarily applies the draft filter for 5s and auto-reverts
- Obfuscation detection ML: tiny on-device classifier to score class names as stable vs. generated (current heuristic is regex-based)
- Generated-filter collision detection — warn when the new rule is a superset/subset of an existing user filter

### Filter management
- Filter history with one-click undo (already exists) expanded to a searchable filter-log panel
- Export user filters as a shareable JSON with per-rule notes
- Per-site enable/disable of user filters
- Auto-disable filters that match zero elements for 30 days (stale filter cleanup)
- Import from AdGuard / ABP / uBlock-Origin-Lite cosmetic syntax with a compatibility note for procedurals that can't cross over

### Upstream rebase
- Track upstream uBO's MV2 branch weekly; upstream is shifting to MV3 (uBlock Lite), fork strategy must account for that
- Publish the divergence as a quilt-style patch series so each change rebases cleanly
- CI build that runs against last-known-good upstream nightly

### Theme
- Theme palette object (Catppuccin Latte/Frappe/Macchiato/Mocha swappable)
- Respect system `prefers-color-scheme`
- Theme-aware logger colors (currently partially themed)

### Safety
- CSP-compatible mode for sites that reject inline-injected filters
- SRI for any external resources the Probe loads (none today, but future plugin paths)
- Sender-origin validation on every message handler

## Competitive Research

- **uBlock Origin (upstream)** — The ground truth. uBO has the smartest dev team in the space; don't out-feature, differentiate on tooling
- **uBlock Origin Lite (MV3)** — The official MV3 successor; uBlockForge needs a story for when MV2 sunsets in Chrome stable
- **AdGuard DevTools Assistant** — Commercial DevTools panel for ad-blocker rule authoring; direct competitor to Element Probe
- **Cosmetic Filters Toolkit (uBO wiki)** — Community docs; pull their examples into the Element Probe help pane

## Nice-to-Haves

- Firefox Android build (Gecko supports MV2 extensions long-term, good niche)
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
- `:matches-attr()`, `:matches-css()`, `:matches-prop()` operators from upstream uBO procedural set — uBO wiki procedural-cosmetic-filters
- `:watch-attr(...)` re-evaluation on attribute change (not just DOM mutation) for SPA-heavy sites like X/YouTube — uBO 1.40+
- `:others()` experimental operator (select everything *not* matching) — uBO wiki, useful for "hide sidebar except X" recipes
- `:min-text-length(n)` to filter only non-trivial text matches and avoid false positives on empty wrappers — uBO procedural syntax
- `:remove()` action operator for DOM removal vs visibility hiding (stops layout-shift flicker) — uBO + AdGuard `{ remove: true; }` equivalence
- Scriptlet injection (`+js(...)`) pipeline for page-world patches, with a vetted scriptlet library — NanoFilters + uBO scriptlets folder
- Live element count in the filter input field as operators change — uBO element picker pattern
- Depth/specificity dual-slider in the generated-filter modal — uBO element picker UI
- Hostname auto-prefix guard (discard generic procedural filters at parse time) — uBO engine invariant
- Compatibility-matrix badge in-panel that warns when a user-authored filter uses operators unsupported in MV3/Ghostery/Brave — inspired by ghostery/adblocker wiki

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

### P0 — Critical (blocks core functionality or security)

- [ ] P0 — Add `devtools_page` to Firefox manifest
  Why: Element Probe (the fork's core differentiator) doesn't load on Firefox at all — the `devtools_page` key is only in `platform/chromium/manifest.json`. Chrome MV2 dies June 30 2026; Firefox is the only platform where MV2 survives indefinitely.
  Evidence: `platform/firefox/manifest.json` missing `devtools_page` entry; `platform/opera/manifest.json` and `platform/thunderbird/manifest.json` also missing it. Build script (`tools/copy-common-files.sh`) copies the HTML files but the manifest never references them.
  Touches: `platform/firefox/manifest.json`, `platform/opera/manifest.json`, `platform/thunderbird/manifest.json`
  Acceptance: Opening DevTools on Firefox with the extension installed shows the "Element Probe" tab.
  Complexity: S

- [ ] P0 — Replace deprecated `/deep/` shadow DOM combinator
  Why: `element-probe-panel.js:791` generates shadow-piercing selectors using `/deep/` which was removed from all browsers years ago. These selectors silently match nothing.
  Evidence: Code at line 791: `result.shadowHost + ' /deep/ ' + result.tag`. Chrome removed `/deep/` in 2018.
  Touches: `src/js/element-probe-panel.js` (INSPECT_SCRIPT shadow DOM section, ~line 789-796)
  Acceptance: Shadow DOM selectors use a functional approach (e.g., uBO's `element.shadowRoot` recursion walk) and either produce a working selector or explicitly report "closed shadow root — unreachable".
  Complexity: M

### P1 — High (significant user value, moderate effort)

- [ ] P1 — Add `:matches-css()`, `:matches-attr()`, `:matches-prop()` procedural operators to Element Probe
  Why: These are upstream uBO operators that Element Probe doesn't generate. `:matches-attr()` matches elements by attribute name/value patterns (regex), `:matches-css()` by computed CSS property values, `:matches-prop()` by JS property values. Essential for sites that use data attributes or CSS-in-JS.
  Evidence: uBO wiki procedural-cosmetic-filters; Ghostery compatibility matrix. Element Probe currently only generates `:has-text()`, `:upward()`, `:matches-path()`, `:not(:has-text())`.
  Touches: `src/js/element-probe-panel.js` (INSPECT_SCRIPT procedural section, ~lines 800-933)
  Acceptance: Inspecting an element with data attributes generates `:matches-attr()` suggestions; elements with distinctive computed styles generate `:matches-css()` suggestions.
  Complexity: M

- [ ] P1 — Add `:min-text-length()` and `:remove()` procedural operators to Element Probe
  Why: `:min-text-length(n)` prevents false positives on empty wrappers (common filter authoring pain point). `:remove()` removes elements from DOM instead of hiding (prevents layout-shift flicker from `display:none`).
  Evidence: uBO wiki procedural syntax; AdGuard `{ remove: true; }` equivalence. Community complaints about layout shift from hidden-not-removed elements.
  Touches: `src/js/element-probe-panel.js` (INSPECT_SCRIPT, procedural filter UI rendering)
  Acceptance: Element Probe offers `:min-text-length()` for elements with short text content, and `:remove()` as an action option alongside the default hiding behavior.
  Complexity: S

- [ ] P1 — Live procedural filter preview
  Why: The #1 filter authoring pain point per community research — authors write procedural filters blind (type syntax, save, reload, check). No tool currently offers interactive procedural preview. Element Probe's "Test filter" button explicitly rejects procedural filters (`btnTestFilter` handler, line 1609-1615).
  Evidence: Reddit r/uBlockOrigin threads, GitHub Issues discussions about filter authoring workflow. AdGuard DevTools assistant also lacks this.
  Touches: `src/js/element-probe-panel.js` (new `PROCEDURAL_PREVIEW_SCRIPT`, `btnTestFilter` handler modification)
  Acceptance: Clicking "Preview" on a `:has-text()` filter highlights matching elements on the page in real-time. Works for `:has-text()`, `:upward()`, `:matches-path()`.
  Complexity: L

- [ ] P1 — Live element count in filter output field
  Why: When a user selects or edits a filter, they can't see how many elements currently match without clicking "Preview". uBO's element picker shows this live. AdGuard's assistant shows it in the input field.
  Evidence: uBO element picker UI pattern; AdGuard DevTools assistant.
  Touches: `src/js/element-probe-panel.js` (filter output section, `syncFilterActions()`)
  Acceptance: A badge or counter next to the filter output shows "N matches" that updates as the user edits the selector.
  Complexity: S

- [ ] P1 — Replace picker polling loop with message passing
  Why: `element-probe-panel.js:1429-1442` polls `window.__ubp_picker_active__` via `setInterval(300ms)` to detect when the user picks an element. This wastes devtools eval bandwidth and has a 300ms detection delay. Should use `inspect()` + a message from the page-context script back to the panel.
  Evidence: Code at lines 1429-1442. Chrome DevTools API documentation recommends message-based communication.
  Touches: `src/js/element-probe-panel.js` (PICK_ELEMENT_SCRIPT and polling handler)
  Acceptance: Element selection is detected within 50ms without polling. No `setInterval` in the picker flow.
  Complexity: S

- [ ] P1 — Use `useContentScriptContext: true` for safe DOM reads
  Why: `evalInPage()` always runs in the page context, which is unnecessary for read-only DOM inspection and exposes the panel to page-world state (e.g., overridden prototypes). Chrome DevTools API supports `useContentScriptContext: true` for safer, isolated reads.
  Evidence: Chrome DevTools API docs; OWASP browser extension security cheat sheet.
  Touches: `src/js/element-probe-panel.js` (`evalInPage()` at line 266-278)
  Acceptance: DOM inspection (INSPECT_SCRIPT) runs in content script context; only highlight/hide scripts run in page context (where they need `querySelectorAll` access).
  Complexity: M

- [ ] P1 — Firefox AMO listing and distribution strategy
  Why: Chrome MV2 dies June 30 2026. Firefox is the only major browser with indefinite MV2 support. The extension already has a Firefox manifest with an AMO-compatible ID (`uBlockVanced@sysadmindoc.dev`) and `gecko_android` settings. Publishing to AMO captures users fleeing Chrome.
  Evidence: Mozilla blog confirming indefinite MV2 support; Chrome 150 MV2 removal confirmed; Firefox manifest already has `browser_specific_settings.gecko.id`.
  Touches: CI/CD workflow (`.github/workflows/main.yml`), signing process, AMO developer account setup
  Acceptance: Extension is installable from addons.mozilla.org. Firefox Android users can install it.
  Complexity: M

### P2 — Medium (quality, testing, DX improvements)

- [ ] P2 — Test suite for fork-specific code
  Why: Zero tests exist for Element Probe, context menu integration, filter persistence, or the class classification heuristic. `package.json` test script is `echo "Error: no test specified" && exit 1`. As the procedural operator set grows, regression risk increases without automated testing.
  Evidence: `package.json:9`; `platform/npm/tests/` only covers upstream SNFE. No test files for `element-probe-panel.js`, `contextmenu.js` probe functions, or `storage.js` fork additions.
  Touches: New test files (e.g., `tests/element-probe/classify-classes.test.js`, `tests/element-probe/inspect-script.test.js`), `package.json` test script
  Acceptance: `npm test` runs tests for `classifyClasses()`, `isValidCssSelector()`, INSPECT_SCRIPT output parsing, and `persistFilter()`/`undoFilter()` round-trip. CI runs these on PR.
  Complexity: L

- [ ] P2 — CI lint job in GitHub Actions workflow
  Why: `npm run lint` (eslint) exists and works but isn't run in CI. Only the build + release job runs. Regressions can be pushed without lint checks.
  Evidence: `.github/workflows/main.yml` has no lint step; `eslint.config.mjs` is configured.
  Touches: `.github/workflows/main.yml`
  Acceptance: PRs and pushes trigger eslint. Lint failures block the build.
  Complexity: S

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

- [ ] P2 — Support exception filters and domain-scoped rules in filter output
  Why: `generateFilter()` only produces `hostname##selector`. No support for exception filters (`#@#`), multi-domain scoping (`domain1,domain2##`), or action operators. Filter authors need these for precise targeting.
  Evidence: `src/js/element-probe-panel.js:1399-1402` — `generateFilter` is 3 lines: `hostname + '##' + selector`.
  Touches: `src/js/element-probe-panel.js` (generateFilter, filter output UI)
  Acceptance: Users can generate exception filters and multi-domain rules from the Element Probe UI. Filter output field has a dropdown for filter type (block/exception/remove).
  Complexity: M

- [ ] P2 — Use `content-visibility: hidden` for cosmetic hiding
  Why: CSS `content-visibility: hidden` (Baseline Sept 2025, all modern browsers) skips rendering of hidden elements entirely (layout + paint + compositing) vs `display: none` which still computes layout. 7x rendering improvement measured in benchmarks for complex ad containers.
  Evidence: MDN `content-visibility` docs; Can I Use data (Chrome 85+, Firefox 125+, Safari 18+).
  Touches: `src/js/element-probe-panel.js` (HIDE_ELEMENT_SCRIPT), potentially `src/js/cosmetic-filtering.js`
  Acceptance: Cosmetic filter hiding uses `content-visibility: hidden` where supported, with `display: none` fallback.
  Complexity: S

- [ ] P2 — In-panel filter syntax help reference
  Why: No user-facing documentation for procedural filter syntax within Element Probe. Users must leave the panel to read the uBO wiki. AdGuard's assistant includes inline help.
  Evidence: No help/documentation content in `src/element-probe-panel.html`. README covers installation but not filter syntax.
  Touches: `src/element-probe-panel.html` (new collapsible help section), `src/css/element-probe-panel.css`
  Acceptance: A "Help" toggle in the panel shows a concise reference for all supported procedural operators with examples.
  Complexity: S

- [ ] P2 — Freeze page state during element picking
  Why: Overlays, popups, and JS-injected content disappear when the picker activates or when focus shifts to DevTools. The picker can't target these dynamic elements. This is the #3 element-picker complaint from community research.
  Evidence: Reddit r/uBlockOrigin threads; GitHub Issues about dynamic content picking failures.
  Touches: `src/js/element-probe-panel.js` (PICK_ELEMENT_SCRIPT — add `debugger` statement or MutationObserver pause before pick)
  Acceptance: Activating pick mode pauses DOM mutations so overlays/popups remain visible for selection.
  Complexity: L

- [ ] P2 — Filter list update diff view in dashboard
  Why: When subscribed filter lists update, users can't see what changed. Debugging breakage from list updates is trial-and-error. This is distinct from the existing "Side-panel diff" nice-to-have (which is about site DOM changes).
  Evidence: Community research — filter list management pain point. No diff UI exists in uBO or any competitor.
  Touches: `src/js/3p-filters.js`, `src/3p-filters.html`, `src/css/3p-filters.css`
  Acceptance: After a filter list updates, a "View changes" link shows added/removed/modified rules since the previous version.
  Complexity: L

### P3 — Low (nice-to-have, future differentiation)

- [ ] P3 — Compatibility matrix badge for cross-engine filter warnings
  Why: Filters using uBO-specific operators (`:has-text()`, `:upward()`) won't work if exported to AdGuard, ABP, Brave, or Ghostery. A visual badge warns users about portability.
  Evidence: Ghostery compatibility matrix wiki; operator support varies widely across engines.
  Touches: `src/js/element-probe-panel.js` (filter output section)
  Acceptance: When a filter uses non-universal operators, a badge shows which engines support it.
  Complexity: M

- [ ] P3 — Add `:watch-attr()` operator to Element Probe
  Why: Re-evaluates filter when specific attributes change (not just DOM mutations). Essential for SPA-heavy sites like X/YouTube where elements are recycled with attribute changes.
  Evidence: uBO wiki — `:watch-attr(...)` added in uBO 1.40+.
  Touches: `src/js/element-probe-panel.js` (INSPECT_SCRIPT procedural section)
  Acceptance: For elements with frequently-changing attributes, Element Probe suggests `:watch-attr()` with the relevant attribute names.
  Complexity: M

- [ ] P3 — Add `:others()` operator to Element Probe
  Why: Selects everything NOT matching a selector. Useful for "hide sidebar except X" recipes. Experimental in upstream uBO.
  Evidence: uBO wiki — `:others()` experimental operator.
  Touches: `src/js/element-probe-panel.js` (INSPECT_SCRIPT procedural section)
  Acceptance: Element Probe offers an "Inverse selection" option that generates `:others()` filters.
  Complexity: S

- [ ] P3 — Snapshot-based regression test suite with real HTML fixtures
  Why: As the procedural operator set grows, testing against contrived inputs isn't enough. Real-world HTML fixtures (YouTube, eBay, news sites) catch edge cases in selector generation that unit tests miss.
  Evidence: Ghostery `adblocker` test runner pattern; upstream uBO's `dig` test infrastructure.
  Touches: New `tests/fixtures/` directory, test runner configuration
  Acceptance: CI runs selector generation against 10+ real-world HTML snapshots and validates output stability across changes.
  Complexity: XL

- [ ] P3 — MV3 Element Probe feasibility assessment
  Why: Chrome MV2 is dead, but MV3's `chrome.devtools.inspectedWindow.eval()` still exists. The main blockers are service worker lifecycle (filter persistence), `chrome.scripting` migration (context menu probe injection), and DNR constraints. Need a documented assessment before committing to MV3 port.
  Evidence: `platform/mv3/chromium/manifest.json` exists but has no `devtools_page`. MV3 scaffold is from upstream uBOL, not adapted for Element Probe.
  Touches: Documentation only (RESEARCH.md update with MV3 port plan)
  Acceptance: Written assessment covers: what works, what needs rewriting, estimated effort, and whether MV3 Element Probe is worth pursuing vs. Firefox-only strategy.
  Complexity: M
