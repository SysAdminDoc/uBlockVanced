# Research — uBlockVanced

## Executive Summary

uBlockVanced is a well-polished MV2 uBlock Origin fork differentiated by its DevTools-integrated Element Probe panel for procedural cosmetic filter authoring, Catppuccin Mocha theme, and YouTube-specific selector generation. The codebase is clean with no TODOs, thorough error handling, and a consistent design token system. However, three critical issues demand immediate attention:

1. **Chrome MV2 dies June 30, 2026 (Chrome 150)** — 10 days away. The extension's primary platform disappears. Firefox must become the primary target immediately.
2. **Element Probe is Chromium-only** — The Firefox manifest lacks `devtools_page`, so the fork's core differentiator doesn't work on the platform where MV2 survives.
3. **Element Probe covers only 4 of 12+ upstream procedural operators** — Missing `:xpath()`, `:matches-css()`, `:matches-attr()`, `:matches-prop()`, `:min-text-length()`, `:watch-attr()`, `:others()`, `:remove()`, `:closest()`.

Top priorities in order:
1. Add `devtools_page` to Firefox manifest (P0 bug — 1 line fix)
2. Firefox-first distribution strategy (AMO listing, Firefox Android build)
3. Expand procedural operator coverage in Element Probe
4. Add sender-origin validation on message handlers (security gap)
5. Replace deprecated `/deep/` shadow DOM combinator
6. Add live procedural filter preview (no tool does this — major differentiator)
7. MV3 migration plan for Chrome users who remain
8. Test infrastructure for fork-specific code
9. i18n for Element Probe panel UI
10. Filter management improvements (per-rule toggle, diff-on-update, conflict detection)

## Product Map

- **Core workflows**: Ad/tracker blocking (inherited from uBO) → Element inspection via DevTools panel → Procedural filter generation → Filter persistence with undo history → Live CSS preview
- **User personas**: Power users writing custom cosmetic filters, filter list authors testing rules, privacy-focused users who need to block dynamic/obfuscated elements (YouTube chat, SPA-rendered ads, Shadow DOM content)
- **Platforms**: Chromium (MV2, dying June 30 2026), Firefox (MV2, indefinite support), Opera, Thunderbird. MV3 scaffolding exists but Element Probe not ported.
- **Key integrations**: uBO's filter engine (cosmeticFilteringEngine, staticNetFilteringEngine), chrome.devtools.inspectedWindow.eval(), chrome.storage.local for filter history, uAssets filter lists

## Competitive Landscape

### uBlock Origin (upstream)
- Latest stable v1.71.0 (May 2026). Recent work: new scriptlets (`freeze-element-property`, `prevent-navigation`), JSONPath RFC 9535 conformance, `top=` and `requestheader` filter options. Fully functional on Firefox (indefinite MV2) and Brave (hardcoded MV2 support).
- **Learn from**: Procedural operator breadth (16+ operators including action operators `:remove()`, `:style()`, `:remove-attr()`, `:remove-class()`), dual-slider element picker UX (depth + specificity), `SelectorCacheEntry` architecture, snapshot-based test suite.
- **Avoid**: Scope creep into upstream's domain — differentiate on tooling and filter authoring UX, not blocking efficacy.

### uBlock Origin Lite (MV3)
- Official MV3 successor. ~30-40% blocking effectiveness loss per gorhill. Cannot block YouTube ads due to DNR limitations. No dynamic filtering, no real-time logger, no scriptlet injection, weak anti-adblock bypass.
- **Learn from**: Layered permissions model (basic/optimal/complete), pre-service-worker static rule loading, DNR rule compilation pipeline.
- **Avoid**: Trying to match full uBO on MV3 — the platform constraints make it impossible. Position uBlockVanced MV2 as the "full power" option on Firefox.

### AdGuard Browser Extension
- Fully migrated to MV3 (v5.2+). Re-enabled custom filters via Chrome's User Scripts API. v5.3 doubled startup speed. Extended CSS via ExtendedCss library includes `:empty-trimmed`, `{ debug: true; }`, `$$` HTML filtering. DevTools assistant is point-and-click (select → adjust size → confirm), not a DevTools panel — simpler but less precise than Element Probe.
- **Learn from**: VS Code extension for filter syntax (AGLint linting, TMLanguage grammar), `{ remove: true; }` / `{ debug: true; }` CSS pseudo-properties, "Quick Fixes" dynamic rule system for MV3.
- **Avoid**: Commercial feature-gating model. Keep everything open.

### Ghostery
- Open-source, account-free (Oct 2025), natively MV3. Uses TrackerDB (database-driven tracker identification) rather than pure filter-list execution. Never-Consent auto-rejects GDPR banners. Distraction Eraser persistently hides elements with cross-visit memory.
- **Learn from**: Compatibility matrix (ground-truth operator support across uBO/ABP/AdGuard/Brave). Never-Consent pattern for cookie banner automation. Distraction Eraser's persistent element hiding concept.
- **Avoid**: Their engine is a rewrite, not a fork — different architecture constraints.

### Brave Built-in Adblocker
- adblock-rust engine with procedural cosmetic filtering (since v1.73), CNAME uncloaking by default, and 75% memory reduction (Jan 2026 overhaul). `CosmeticFilterCache` uses flat multimaps for efficient hostname lookups. No user-facing filter authoring UI — Brave Shields is toggle-based only.
- **Learn from**: CNAME uncloaking via Firefox `dns.resolve()` API, memory-efficient `CosmeticFilterCache` architecture, two-phase cosmetic filtering (URL-specific at load, generic on discovery).
- **Avoid**: Building native code — the extension model doesn't support it well.

### Notable Gap
- No significant maintained uBO forks with new features exist on GitHub. uBlockVanced is the first feature-adding fork in a largely empty space. No existing tool combines DevTools-level DOM inspection with procedural cosmetic filter generation.

## Security, Privacy, and Reliability

### Bugs Found
- **Firefox manifest missing `devtools_page`** (`platform/firefox/manifest.json`) — Element Probe doesn't load on Firefox at all. Same gap in Opera and Thunderbird manifests.
- **Deprecated `/deep/` combinator** (`src/js/element-probe-panel.js:791`) — Shadow DOM piercing selector uses `/deep/` which was removed from Chrome years ago. Generates non-functional selectors.
- **No sender-origin validation** on `createUserFilter` and `removeUserFilter` message handlers (`src/js/messaging.js:152-166`). Per OWASP browser extension security guidelines, all message handlers should validate `sender.id === chrome.runtime.id` and check `sender.url` starts with the extension's origin.
- **Polling loop for picker state** (`src/js/element-probe-panel.js:1429-1442`) — Uses `setInterval(300ms)` to poll `window.__ubp_picker_active__` instead of message passing. Wastes resources and has a 300ms detection delay.

### Missing Guardrails
- No CSP on the Element Probe panel HTML (inherits extension default, which is safe for MV2 but won't survive MV3 migration).
- Filter history stored in plaintext `chrome.storage.local` — acceptable for filter text but worth noting if the scope expands to include user annotations.
- `evalInPage()` passes user-selected selectors through `JSON.stringify()` before injection, which prevents basic injection, but the broad use of `chrome.devtools.inspectedWindow.eval()` remains a large attack surface if the panel is ever exposed to untrusted input.

### Recovery and Rollback
- Filter history with undo exists and works correctly (tested in v0.2.5 hardening pass).
- No backup/restore for Element Probe settings or history separate from the main uBO backup.
- No crash recovery — if the DevTools panel closes during a filter save, the `panelClosed` flag prevents UI updates but the filter may or may not have been written.

## Architecture Assessment

### Module Improvements Needed
- `element-probe-panel.js` (1822 lines) is a single IIFE containing all panel logic — inspection scripts, UI rendering, event handlers, history management, picker, frame targeting. Should be split into modules: `inspect.js`, `ui.js`, `history.js`, `picker.js`, `frame-targeting.js`.
- The INSPECT_SCRIPT is a 400-line string template that runs in the page context. It generates all selectors and procedural filters inline. Adding new operators requires modifying this monolithic string. Should be refactored into a composable pipeline.
- `generateFilter()` is trivially simple (`hostname + '##' + selector`) — no support for exception filters (`#@#`), action operators (`:remove()`), or domain-scoped rules (`domain1,domain2##`).

### Refactor Candidates
- `src/js/element-probe-panel.js:608-630` — `classifyClasses()` regex heuristic for stable vs. dynamic class detection. 11 regex patterns hardcoded in the page-context script. Should be a configurable/extensible classifier.
- `src/js/element-probe-panel.js:266-278` — `evalInPage()` wrapper. Should support `useContentScriptContext: true` option for safer DOM reads (per Chrome DevTools API best practices).
- `src/js/contextmenu.js:165-187` — `ensureProbeListener()` injects a raw code string via `vAPI.tabs.executeScript`. Uses MV2-only API that won't survive MV3 migration.

### Test Gaps
- **Zero tests for fork-specific code.** `package.json` test script is `echo "Error: no test specified" && exit 1`. The npm test suite (`platform/npm/tests/`) only covers upstream SNFE tests.
- No test for the INSPECT_SCRIPT output format.
- No test for `classifyClasses()` regex patterns against known CSS-in-JS class name formats.
- No test for `persistFilter()`/`undoFilter()` round-trip.
- No test for `isValidCssSelector()` edge cases.
- No CI lint job in the GitHub workflow — only build + release.

### Documentation Gaps
- No user-facing documentation for Element Probe beyond README installation steps.
- No filter syntax reference or help panel within Element Probe itself.
- No contributing guide specific to the fork (CONTRIBUTING.md points to upstream).
- Upstream changelog entries (v1.54.0–1.70.0) included verbatim in CHANGELOG.md without noting which are relevant to the fork.

## Rejected Ideas

| Idea | Reason | Source |
|------|--------|--------|
| Auto-sync across devices | Privacy concern + complexity exceeds fork scope; uBO declined for 10 years | Reddit r/uBlockOrigin, multiple threads |
| ASN/GeoIP-based blocking | Requires external database dependency, maintenance burden, niche use case | GitHub Discussions |
| Built-in ad-detection ML model | Model size, training data requirements, false positive risk — not viable for a lightweight extension | General ML-in-extensions research |
| Rewrite filter engine in Rust/WASM | Massive scope, diverges from upstream, Brave already did this (adblock-rust) | Competitive analysis |
| Port to Safari MV3 | Safari lacks `devtools_page` API entirely — Element Probe cannot exist on Safari | Browser API research |
| Chrome Web Store publication | Chrome MV2 extensions can no longer be published to CWS; MV3 variant would lose Element Probe's `eval()` capabilities | Chrome MV2 deprecation timeline |
| `:closest()` procedural operator | uBO upstream explicitly declined this; implementing it would create filter syntax divergence that breaks cross-engine compatibility | GitHub Issue #2190 |

## Sources

**Browser Platform**
- https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
- https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3
- https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/filterResponseData
- https://blog.mozilla.org/addons/2024/03/13/manifest-v3-manifest-v2-march-2024-update/
- https://developer.chrome.com/docs/extensions/reference/api/devtools/inspectedWindow
- https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility
- https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API

**Competitors & Ecosystem**
- https://github.com/gorhill/uBlock (upstream, v1.71.0)
- https://github.com/uBlockOrigin/uBOL-home (MV3 variant)
- https://github.com/AdguardTeam/AdguardBrowserExtension
- https://github.com/AdguardTeam/ExtendedCss (extended CSS library)
- https://github.com/AdguardTeam/VscodeAdblockSyntax (VS Code filter syntax)
- https://github.com/ghostery/adblocker (engine + compatibility matrix)
- https://github.com/brave/adblock-rust (Rust adblocker)
- https://github.com/fczbkk/css-selector-generator (selector generation algorithms)

**Community Signal**
- https://github.com/uBlockOrigin/uBlock-issues/issues/2190 (`:closest()` request)
- https://github.com/uBlockOrigin/uBlock-issues/issues/803 (Shadow DOM cosmetic filters)
- https://github.com/uBlockOrigin/uBlock-issues/issues/2297 (eBay Shadow DOM)
- https://github.com/uBlockOrigin/uBlock-issues/discussions/3322 (YouTube Trusted Types)
- https://github.com/gorhill/uBlock/issues/2072 (screen reader accessibility)

**Security**
- https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html

**Filter Syntax & Tooling**
- https://github.com/gorhill/uBlock/wiki/Static-filter-syntax
- https://github.com/gorhill/uBlock/wiki/Procedural-cosmetic-filters
- https://github.com/gorhill/uBlock/wiki/Element-picker
- https://tueksta.github.io/adblock-filter-analyzer/ (filter validator)
- https://hub.filterlists.com/t/useful-tools-for-maintaining-filter-lists/18

## Open Questions

1. **Is Firefox AMO listing planned?** The extension ID (`uBlockVanced@sysadmindoc.dev`) is declared in the Firefox manifest, suggesting AMO publication is intended but hasn't happened. This is the most impactful distribution decision given Chrome MV2's death.
2. **What is the upstream rebase strategy post-MV2?** Upstream uBO is shifting focus to MV3 (uBOL). If upstream MV2 receives only security fixes, the fork must decide: track upstream MV2 maintenance branch, or selectively cherry-pick from MV3 work?
3. **Should Element Probe target the MV3 variant?** MV3's `chrome.devtools.inspectedWindow.eval()` is still available, but service worker lifecycle and `chrome.scripting` migration would require significant rework of the context menu integration and filter persistence flow.
