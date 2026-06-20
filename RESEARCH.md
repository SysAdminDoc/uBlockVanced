# Research — uBlockVanced

## Executive Summary

uBlockVanced is the only actively maintained uBlock Origin fork adding new features. Its DevTools-integrated Element Probe panel — with 12 procedural operators, live preview, compatibility badges, timer freezing, and a "Test (5s)" temporary filter button — has no equivalent in any competitor. The codebase is clean (30 unit tests, CI lint, consistent design tokens, no unresolved TODOs in fork code).

**The strategic landscape has shifted**: Chrome MV2 died in August 2025 (Chrome 139). The extension no longer functions on Chrome. Firefox (indefinite MV2 support) is the only viable primary platform. gorhill is building a full MV3 uBO (not just uBOL) using the `userScripts` API for scriptlet injection — competing on MV3 would mean competing directly with upstream on their strongest ground.

The fork's best path: **become the best filter authoring tool on Firefox MV2**, where upstream is feature-complete but under-tooled.

Top priorities:
1. **Infrastructure**: add tests to CI, fix Makefile fork references (gorhill → SysAdminDoc)
2. **Operator parity**: `:style()` generation, `:matches-path()` generation, `:matches-prop()` generation
3. **Accessibility**: `forced-colors` media query (zero rules exist; `prefers-reduced-motion` and `prefers-contrast` are covered)
4. **Security**: Trusted Types compatibility for cosmetic injection on Google/YouTube
5. **Filter authoring**: exception filters (`#@#`), multi-domain scoping, auto-strip `www.` prefix
6. **UX wins**: replace picker state polling with messages, resizable logger columns

## Product Map

- **Core workflows**: Ad/tracker blocking (inherited from uBO) → element inspection via DevTools panel → procedural filter generation → filter persistence with undo history → live CSS/procedural preview → temporary filter testing
- **User personas**: Power users writing custom cosmetic filters; filter list authors testing rules; privacy-focused users blocking dynamic/obfuscated elements (YouTube chat, SPA ads, Shadow DOM)
- **Platforms**: Firefox MV2 (primary, indefinite support), Edge (MV2 status TBD), Opera (MV2), Thunderbird. MV3 scaffolding exists for Chromium/Firefox/Safari but Element Probe not ported. Chrome MV2 is dead (since Aug 2025).
- **Key integrations**: uBO's filter engine (cosmeticFilteringEngine, staticNetFilteringEngine), `chrome.devtools.inspectedWindow.eval()`, `chrome.storage.local` for filter history, uAssets filter lists
- **Distribution**: GitHub releases only. Firefox AMO listing blocked on credentials (in Roadmap_Blocked.md). No Chrome Web Store path exists (MV2 listings delisted).

## Competitive Landscape

### uBlock Origin (upstream) — v1.71.0, May 2026
Actively maintained for Firefox MV2 and building a full MV3 version. Recent additions: `freeze-element-property`/`prevent-navigation` scriptlets, `requestheader`/`top=` filter options, JSONPath RFC 9535 conformance, `edit-object-on-[getter|setter]` scriptlets. 16+ procedural operators including action operators (`:remove()`, `:style()`, `:remove-attr()`, `:remove-class()`). ~10.9M Firefox users.
- **Learn from**: Full procedural operator set (`:style()`, `:matches-css-before/after()`, `:matches-media()` are in upstream but not in Element Probe), `SelectorCacheEntry` architecture, dual-slider element picker depth/specificity UI.
- **Avoid**: Scope creep into upstream's domain. Differentiate on tooling and filter authoring UX.

### AdGuard Browser Extension — v5.4.3.1, May 2026
Ships MV2 and MV3 simultaneously. v5.3 doubled startup speed with native `:has()` CSS delegation. Custom filters update independently in MV3 since v5.4.1. Has AGLint (filter linter), VS Code syntax extension, DeadDomainsLinter, and ExtendedCss library with `:matches-property()` (JS property chains) and `:empty-trimmed`.
- **Learn from**: AGLint for CI filter validation, `{ debug: true; }` CSS pseudo-property for filter debugging, independent custom filter updates in MV3.
- **Avoid**: Commercial feature-gating. Keep everything open.

### Ghostery — v10.5.48, June 2026
MV3-native, open-source, account-free. TrackerDB (database-driven tracker identification), Never-Consent (auto-reject cookie popups via `@duckduckgo/autoconsent`), "Distractions" feature (hide YouTube Shorts, Reels, social share widgets, Google Sign-In popups), GPC signal. Adblocker engine has published compatibility matrix across uBO/ABP/AdGuard/Brave.
- **Learn from**: "Distractions" as a differentiation category beyond pure ad-blocking. Never-Consent auto-dismiss pattern. GPC signal support.
- **Avoid**: Their engine is a rewrite, not a fork — different architecture constraints.

### Brave Shields / adblock-rust — v0.12.5
Rust-based engine with procedural cosmetic filtering (9 operators + 4 action types), FlatBuffers serialization, CNAME uncloaking at browser level. January 2026 overhaul: 75% memory reduction, `CosmeticFilterCache` flat multimaps. Recent focus: double-hashing elimination, domain parsing speedup, allocation reduction.
- **Learn from**: Memory-efficient `CosmeticFilterCache` architecture, two-phase cosmetic filtering.
- **Avoid**: Building native code or competing on engine performance.

### Selector Generation Libraries
`antonmedv/finder` (1,486 stars): shortest unique CSS selectors, 1.5KB. `fczbkk/css-selector-generator` (596 stars): Shadow DOM support built-in, configurable selector priority, `ignoreGeneratedClassNames`. Both are reference implementations for selector robustness algorithms — Element Probe's `classifyClasses()` heuristic parallels css-selector-generator's class filtering approach.

### Notable Gap
No other actively maintained uBO fork adds new features. The only visible fork ("youblock" — Material You reskin of uBOL, 1 star) is superficial. uBlockVanced occupies an uncontested niche.

## Security, Privacy, and Reliability

### Fixed Since Last Research (verified)
- Firefox manifest now has `devtools_page` — Element Probe works on Firefox ✓
- Deprecated `/deep/` Shadow DOM combinator removed from codebase ✓
- PEM signing key is gitignored and not tracked ✓

### Remaining Gaps
- **No sender-origin validation** on `createUserFilter` and `removeUserFilter` message handlers (`src/js/messaging.js`). Chrome's `runtime.onMessage` only accepts messages from extension scripts (implicit isolation), but `web_accessible_resources` could theoretically send messages. Defense-in-depth recommendation: validate `sender.id === chrome.runtime.id`. Severity: low (MV2 messaging is well-isolated).
- **Trusted Types enforcement** on Google/YouTube properties. Sites using `require-trusted-types-for 'script'` CSP may reject cosmetic filter injection that uses `innerHTML`-style DOM manipulation. uBO's content scripts may need adaptation for pages enforcing Trusted Types. Severity: medium (affects primary use case sites).
- **Picker state polling** (`src/js/element-probe-panel.js`) uses `setInterval(300ms)` to poll `window.__ubp_picker_active__` instead of message passing. Wastes resources with 300ms detection delay. Severity: low (performance, not security).
- **`chrome.devtools.inspectedWindow.eval()` attack surface** — Chrome explicitly warns this is "powerful when used in the right context and dangerous when used inappropriately." The inspected page can affect returned data. Element Probe sanitizes via `JSON.stringify()` before injection and uses `JSON.parse()` for returned data, which is adequate. The `useContentScriptContext: true` option cannot replace this because the INSPECT_SCRIPT depends on `$0` (the DevTools-selected element reference), which is only available in page context.
- **No `forced-colors` media query rules** in any CSS file. `prefers-reduced-motion` is handled (3 files: `common.css`, `element-probe-panel.css`, `epicker-ui.css`) and `prefers-contrast: more` has one rule in `themes/default.css`, but `forced-colors: active` has zero rules. Users with Windows High Contrast mode enabled will see a broken UI.

### Recovery and Rollback
- Filter history with undo works correctly (hardened in v0.2.5).
- No backup/restore for Element Probe settings separate from main uBO backup.
- No crash recovery during filter save (panelClosed flag prevents UI updates but filter state may be inconsistent).

## Architecture Assessment

### Strengths
- Element Probe is the fork's unique value. 2324 lines, 12 procedural operators, live preview, compatibility badges, timer freezing, "Test (5s)" temporary filters — no competitor has this.
- Design token system (`src/css/themes/default.css`) is thorough: radius scale, surface layers, focus rings, colorblind variants, scrollbar tokens.
- Build is simple (bash scripts + Makefile, no bundler) — easy to understand and modify.
- Zero runtime npm dependencies. Everything vendored or self-contained.

### Module Improvements Needed
- `element-probe-panel.js` (2324 lines) is still a single IIFE containing all panel logic. Already on roadmap as P2 modularization item.
- INSPECT_SCRIPT is a ~400-line string template running in page context. Each operator is an inline function within this string. The recent operator additions (12 commits today) show this is workable but fragile — adding `:style()` or `:matches-css-before/after()` means modifying this monolithic template.
- `generateFilter()` is trivially simple (`hostname + '##' + selector`). No support for exception filters (`#@#`), action operators with arguments (`:style(opacity: 0)`), or multi-domain scoping (`domain1,domain2##`).

### Build Infrastructure Issues
- **Makefile publish targets** still reference `gorhill` and `uBlock` in 8 places (lines 105-165). These would deploy to the wrong GitHub repo if ever triggered.
- **CI runs lint but not tests**. The 30 test cases in `tests/` are never executed in CI. `npm test` exists but isn't in the workflow.
- **Upstream SNFE tests** exist at `platform/npm/tests/` but are not integrated into the fork's CI either.

### Test Coverage
- Fork-specific: `tests/classify-classes.test.js` (12 cases), `tests/selector-validation.test.js` (18 cases). Uses Node.js built-in test runner.
- Upstream npm: `platform/npm/tests/snfe.js`, `leaks.js`, `wasm.js`.
- Manual test pages: `docs/tests/` with HTML fixtures for cosmetic/procedural/scriptlet filters.
- **Gaps**: no tests for `persistFilter()`/`undoFilter()` round-trip, `generateFilter()` output, `isValidCssSelector()` edge cases, message handlers, or context menu integration.
- **Upstream uBO has zero tests** (`package.json` test script is `echo "Error: no test specified"`). Any test infrastructure in the fork is a differentiation.

### Documentation Gaps
- No user-facing documentation for Element Probe beyond README installation steps (syntax help panel added today partially addresses this).
- CONTRIBUTING.md points to upstream.
- Upstream changelog entries included verbatim in CHANGELOG.md.

## Rejected Ideas

| Idea | Reason | Source |
|------|--------|--------|
| Build MV3 variant to compete with upstream | gorhill is building full MV3 uBO with `userScripts` API. Competing on MV3 means competing with upstream on their strongest ground. Fork's value is MV2 tooling on Firefox. | gorhill/uBlock master branch, 60+ `[mv3]` commits Feb-Jun 2026 |
| Auto-sync filters across devices | Privacy concern + complexity exceeds fork scope; uBO declined for 10+ years | Reddit r/uBlockOrigin |
| ASN/GeoIP-based blocking | External database dependency, maintenance burden, niche use case | GitHub discussions |
| Built-in ad-detection ML model | Model size, training data, false positive risk — not viable for lightweight extension | General ML-in-extensions research |
| Rewrite filter engine in Rust/WASM | Massive scope, diverges from upstream. Brave already did this (adblock-rust). | Competitive analysis |
| Port to Safari MV3 | Safari lacks `devtools_page` API entirely. Element Probe cannot exist on Safari. | Browser API research |
| Chrome Web Store publication | Chrome MV2 extensions delisted. MV3 variant would lose Element Probe's `eval()` capabilities. | Chrome MV2 deprecation timeline |
| `:closest()` procedural operator | uBO upstream explicitly declined; implementing creates filter syntax divergence breaking cross-engine compatibility | uBlock-issues #2190 |
| Replace selector generation with external library | `finder`/`css-selector-generator` generate generic unique selectors; Element Probe generates ad-blocking-specific procedural filters using `$0` in page context — fundamentally different goal | Architecture analysis |
| CNAME uncloaking in extension | Already handled by upstream uBO on Firefox via `dns` permission. Fork inherits this. | gorhill/uBlock wiki |

## Sources

**Browser Platform**
- https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline
- https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
- https://developer.chrome.com/docs/extensions/reference/api/userScripts
- https://developer.chrome.com/docs/extensions/reference/api/devtools/inspectedWindow
- https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors
- https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility
- https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/
- https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/manifest-v3

**Competitors & Ecosystem**
- https://github.com/gorhill/uBlock
- https://github.com/gorhill/uBlock/wiki/Procedural-cosmetic-filters
- https://github.com/uBlockOrigin/uBOL-home
- https://github.com/AdguardTeam/AdguardBrowserExtension
- https://github.com/AdguardTeam/ExtendedCss
- https://github.com/ghostery/ghostery-extension
- https://github.com/ghostery/adblocker
- https://github.com/brave/adblock-rust
- https://github.com/duckduckgo/autoconsent

**Tooling**
- https://github.com/AdguardTeam/AGLint
- https://github.com/AdguardTeam/DeadDomainsLinter
- https://github.com/AdguardTeam/VscodeAdblockSyntax
- https://github.com/antonmedv/finder
- https://github.com/fczbkk/css-selector-generator

**Community & Issues**
- https://github.com/uBlockOrigin/uBlock-issues/issues
- https://github.com/ghostery/trackerdb

**Testing & Accessibility**
- https://playwright.dev/docs/chrome-extensions
- https://github.com/acvetkov/sinon-chrome
- https://extensionworkshop.com/documentation/develop/build-an-accessible-extension/
- https://www.w3.org/WAI/ARIA/apg/patterns/

## Open Questions

1. **Firefox AMO listing** — the single most impactful distribution decision given Chrome's death. Extension ID (`uBlockVanced@sysadmindoc.dev`) is declared in the Firefox manifest. Blocked on AMO developer account credentials.
2. **Upstream sync strategy** — gorhill's `master` branch now has extensive MV3 code mixed with MV2 fixes. Cherry-picking MV2-only fixes without pulling MV3 architecture requires a disciplined rebase strategy. The fork has only 35 commits on top of upstream — the delta is manageable now but will grow.
3. **Firefox Android positioning** — DevTools panels do not work on Firefox Android. Should Element Probe degrade gracefully (show a "not available on mobile" message) or should the Firefox Android build omit it entirely? The core ad-blocking functionality works fine on Android — only the fork-specific tooling is affected.
