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
