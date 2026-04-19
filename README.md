

<p align="center">
  <img src="src/img/icon_128.png" alt="uBlockVanced" width="80">
</p>

<h1 align="center">uBlockVanced v0.2.6</h1>

<p align="center">
  Enhanced fork of <a href="https://github.com/gorhill/uBlock">uBlock Origin</a> (Manifest V2) with deep element inspection, procedural cosmetic filters, and Catppuccin Mocha dark theme.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V2-blue" alt="MV2">
  <img src="https://img.shields.io/badge/Theme-Catppuccin%20Mocha-cba6f7" alt="Catppuccin Mocha">
  <img src="https://img.shields.io/badge/License-GPLv3-green" alt="GPLv3">
</p>
<p align="center">
<img width="2931" height="1216" alt="2026-04-19 13_44_21-OpenCut and 5 more tabs - File Explorer" src="https://github.com/user-attachments/assets/2f90e569-98fc-44e1-b6c6-e410bb3dd5d5" />
<img width="589" height="463" alt="2026-04-19 13_43_32-OpenCut and 5 more tabs - File Explorer" src="https://github.com/user-attachments/assets/474ec598-d6f6-402f-a940-f1f0de7c0acb" />
<img width="961" height="669" alt="2026-04-19 13_43_46-OpenCut and 5 more tabs - File Explorer" src="https://github.com/user-attachments/assets/400fdf32-05d6-4e33-beea-aebfd87a314e" />
</p>
---

## What's Different

uBlockVanced adds a **DevTools panel called Element Probe** that solves a specific problem: uBlock Origin's standard element picker can't select elements with obfuscated CSS classes, shadow DOM boundaries, or dynamic content like YouTube live chat banners.

### Element Probe Features

- **Deep element inspection** via `chrome.devtools.inspectedWindow.eval()` -- bypasses content script limitations
- **Procedural cosmetic filter generation**:
  - `:has-text()` -- match elements by their text content (regex supported)
  - `:upward(N)` / `:upward(selector)` -- target ancestor elements from a known child
  - `:matches-path()` -- restrict filters to specific URL paths
  - `:not(:has-text())` -- inverse text matching
- **YouTube-specific selectors** for live chat banners, tickers, and custom elements with dynamic classes
- **Shadow DOM scanning** and piercing selectors
- **iframe detection** and analysis
- **Smart class classification** -- distinguishes stable class names from obfuscated/dynamic ones (CSS-in-JS, styled-components, emotion, etc.)
- **Filter history with undo** -- persisted in `chrome.storage.local`, revert applied filters
- **Proper filter persistence** via uBlock's `createUserFilter` messaging channel
- **Visual element picker** -- hover-to-highlight with `inspect()` integration to set `$0`
- **Right-click context menu** -- "Inspect with Element Probe" on any page element
- **Live preview** -- hover over generated selectors to highlight matching elements

### Theme

Full **Catppuccin Mocha** dark theme applied across:
- Element Probe DevTools panel
- Element picker overlay (epicker)
- Logger UI (all hardcoded colors replaced with theme-aware values)
- DOM inspector
- Filter list pages
- Dynamic filtering dialog (allow/block/noop action colors)

### Base

All standard uBlock Origin features remain intact -- ad blocking, filter lists, dynamic filtering, logger, cloud sync, etc.

## Installation

1. Clone: `git clone https://github.com/SysAdminDoc/uBlockVanced.git`
2. Open `chrome://extensions/` in Chrome/Edge
3. Enable **Developer mode**
4. Click **Load unpacked** and select the `src/` directory
5. Open DevTools (F12) on any page -- the **Element Probe** tab appears

## Usage

### Element Probe (DevTools Panel)

1. Open DevTools (F12) on any page
2. Navigate to the **Element Probe** tab
3. Either:
   - Select an element in the Elements panel, then click **Inspect Selected Element**
   - Click **Pick from Page** to hover-and-click select directly
4. Review generated **CSS Selectors** (standard) and **Procedural Filters** (`:has-text`, `:upward`, etc.)
5. Click a selector/filter to populate the filter output
6. **Apply Filter** persists it to uBlock's user filter list
7. Use **Filter History** to undo/redo applied filters

### Context Menu

Right-click any element and select **Inspect with Element Probe** to set it as the DevTools `$0` reference, then switch to the Element Probe panel.

## Building

```bash
make chromium   # Build for Chrome/Edge
make firefox    # Build for Firefox
make opera      # Build for Opera
```

## License

[GPLv3](LICENSE.txt)

Based on [uBlock Origin](https://github.com/gorhill/uBlock) by Raymond Hill.
