/*******************************************************************************

    uBlockVanced - Element Probe Panel v0.3.0

    Deep element inspection panel for Chrome DevTools.
    Generates robust CSS selectors AND procedural cosmetic filters for elements
    that uBlock's standard element picker cannot select, including shadow DOM
    elements, obfuscated/dynamic class names, YouTube live chat banners, and
    other stubborn elements.

    Features:
    - Standard CSS selector generation (ID, class, attribute, structural, :has())
    - Procedural cosmetic filters (:has-text(), :upward(), :matches-path())
    - YouTube-specific selectors for live chat banners/tickers
    - Shadow DOM piercing
    - Filter history with undo
    - Proper persistence via uBlock's vAPI messaging channel
    - Live element picking via chrome.devtools.inspectedWindow.eval + inspect()

    Uses chrome.devtools.inspectedWindow.eval() to access the inspected page's
    DOM with full privileges, bypassing content script limitations.

*******************************************************************************/

import {
    DEFAULT_CLASS_PATTERNS,
    HIDE_ELEMENT_SCRIPT,
    HIGHLIGHT_SCRIPT,
    PICK_ELEMENT_SCRIPT,
    PROCEDURAL_HIGHLIGHT_SCRIPT,
    REMOVE_HIGHLIGHT_SCRIPT,
    SCAN_IFRAMES_SCRIPT,
    SCAN_SHADOW_SCRIPT,
    YT_SWEEP_SCRIPT,
    buildInspectScript,
} from './element-probe/page-scripts.js';

const $ = id => document.getElementById(id);

const i18n = key => chrome.i18n.getMessage(key) || '';

function renderI18n() {
    for (const el of document.querySelectorAll('[data-i18n]')) {
        const text = i18n(el.getAttribute('data-i18n'));
        if (text) { el.textContent = text; }
    }
    for (const el of document.querySelectorAll('[data-i18n-title]')) {
        const text = i18n(el.getAttribute('data-i18n-title'));
        if (text) { el.title = text; }
    }
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
        const text = i18n(el.getAttribute('data-i18n-placeholder'));
        if (text) { el.placeholder = text; }
    }
}
renderI18n();

// Set to true once the panel window unloads so async callbacks (devtools eval,
// storage, sendMessage) skip UI updates instead of touching a detached DOM.
let panelClosed = false;
window.addEventListener('pagehide', () => { panelClosed = true; }, { once: true });
window.addEventListener('unload', () => { panelClosed = true; }, { once: true });

const MAX_LOG_ENTRIES = 120;
const log = (msg, type = '') => {
    if (panelClosed) { return; }
    const el = $('log');
    if (!el) { return; }
    const entry = document.createElement('div');
    entry.className = 'log-entry' + (type ? ' ' + type : '');
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    el.appendChild(entry);
    while (el.childElementCount > MAX_LOG_ENTRIES) {
        el.firstElementChild.remove();
    }
    el.scrollTop = el.scrollHeight;
    syncLogState();
};

let currentSelectors = [];
let selectedSelectorIndex = -1;
let currentHostname = '';
let currentPageUrl = '';
let isHighlighting = false;
let lastInspectedData = null;
let currentFrameUrl = ''; // empty = top frame

// Filter history (persisted in chrome.storage.local)
let filterHistory = [];
const HISTORY_KEY = 'elementProbe_filterHistory';
const MAX_HISTORY = 50;

/******************************************************************************/

const setStatus = (text, state = '') => {
    if (panelClosed) { return; }
    const statusText = $('statusText');
    if (statusText) { statusText.textContent = text; }
    const dot = $('statusDot');
    if (dot) {
        dot.className = 'status-dot';
        if (state) { dot.classList.add(state); }
    }
    const indicator = document.querySelector('.status-indicator');
    if (indicator) {
        indicator.dataset.state = state || 'idle';
    }
};

const setSelectionSummary = text => {
    const el = $('selectionSummary');
    if (el) {
        el.textContent = text;
    }
    updateWorkflowSummary();
};

const setText = (id, text) => {
    const el = $(id);
    if (el) {
        el.textContent = text;
    }
};

const truncate = (text, max = 88) => {
    if (typeof text !== 'string') { return ''; }
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= max) { return normalized; }
    return normalized.slice(0, max - 1) + '\u2026';
};

const getCurrentFrameLabel = () => {
    const select = $('frameTarget');
    if (select && currentFrameUrl) {
        const option = select.options[select.selectedIndex];
        if (option && option.textContent) {
            return option.textContent.trim();
        }
        return 'Selected iframe';
    }
    return 'Top document';
};

const formatSelectionLabel = data => {
    if (!data) { return 'Waiting for a node'; }
    const label = [];
    if (data.tag) { label.push(`<${data.tag}>`); }
    if (data.id) { label.push(`#${data.id}`); }
    if (Array.isArray(data.classes) && data.classes.length !== 0) {
        label.push(`.${data.classes[0]}`);
    }
    return label.join(' ') || 'Selected element';
};

const syncLogState = () => {
    const el = $('log');
    if (!el) { return; }
    el.dataset.empty = el.childElementCount === 0 ? 'true' : 'false';
};

const updateFilterHint = () => {
    const section = $('filterSection');
    const output = $('filterOutput');
    if (!section || !output) { return; }
    const value = output.value.trim();
    const hasValue = value !== '';
    const isProcedural = /:has-text|:upward|:xpath\(|:matches-path|:matches-attr|:matches-css|:matches-media|:matches-prop|:min-text-length|:remove\(\)|:style\(|:watch-attr|:others\(\)|:not\(:has-text\(/i.test(value);

    let badge = 'Selection required';
    let text = 'Choose a selector or procedural filter to build a rule.';
    let mode = 'idle';

    if (lastInspectedData && hasValue === false) {
        const selectorCount = currentSelectors.length;
        badge = 'Choose a selector';
        text = selectorCount === 0
            ? 'No stable selectors were generated for this node yet. Try scanning shadow DOM or picking a different ancestor.'
            : `${selectorCount} selector suggestion${selectorCount === 1 ? '' : 's'} ready. Pick the most stable option before saving.`;
        mode = 'ready';
    } else if (hasValue && isProcedural) {
        badge = 'Procedural rule';
        text = 'Procedural rule — click Preview to highlight matching elements, or Apply to save to your filters.';
        mode = 'procedural';
    } else if (hasValue && isHighlighting) {
        badge = 'Preview active';
        text = 'The current selector is highlighted in the inspected page. Save it if the match looks right, or clear the preview.';
        mode = 'preview';
    } else if (hasValue) {
        badge = 'Rule ready';
        text = 'CSS selectors can be previewed before saving, copied for review, or sent straight to your user filters.';
        mode = 'ready';
    }

    section.dataset.mode = mode;
    setText('filterHintBadge', badge);
    setText('filterHintText', text);
};

const updateWorkflowSummary = () => {
    const frameCount = Math.max(($('frameTarget')?.options.length || 1) - 1, 0);
    const hasFilterValue = $('filterOutput')?.value.trim() !== '';
    const isProcedural = /:has-text|:upward|:xpath\(|:matches-path|:matches-attr|:matches-css|:matches-media|:matches-prop|:min-text-length|:remove\(\)|:style\(|:watch-attr|:others\(\)|:not\(:has-text\(/.test($('filterOutput')?.value || '');

    setText('overviewTargetValue', currentFrameUrl ? 'Focused iframe' : 'Top document');
    setText(
        'overviewTargetHint',
        currentFrameUrl
            ? truncate(getCurrentFrameLabel(), 84)
            : frameCount === 0
                ? 'Inspecting the main page context.'
                : `${frameCount} iframe target${frameCount === 1 ? '' : 's'} detected on this page.`
    );

    if (lastInspectedData) {
        setText('overviewSelectionValue', formatSelectionLabel(lastInspectedData));
        setText(
            'overviewSelectionHint',
            lastInspectedData.inShadowDOM
                ? `Inside shadow DOM${lastInspectedData.shadowHost ? ` via ${lastInspectedData.shadowHost}` : ''}.`
                : truncate(lastInspectedData.textContent || `On ${lastInspectedData.hostname || 'the current page'}`, 84)
        );
    } else {
        setText('overviewSelectionValue', 'Waiting for a node');
        setText('overviewSelectionHint', 'Select in Elements or use Pick on page.');
    }

    if (!lastInspectedData) {
        setText('overviewOutputValue', 'No output yet');
        setText('overviewOutputHint', 'Inspect an element to generate selectors and cosmetic rules.');
        return;
    }

    const proceduralCount = Array.isArray(lastInspectedData.proceduralFilters)
        ? lastInspectedData.proceduralFilters.length
        : 0;

    if (hasFilterValue) {
        if (isProcedural) {
            setText('overviewOutputValue', 'Procedural rule ready');
            setText('overviewOutputHint', 'Save it to your filters, then reload the page to validate the result.');
        } else if (isHighlighting) {
            setText('overviewOutputValue', 'Previewing rule');
            setText('overviewOutputHint', 'A live highlight is active on the inspected page for the current selector.');
        } else {
            setText('overviewOutputValue', 'Rule ready');
            setText('overviewOutputHint', 'Preview, copy, or save the current selector as a cosmetic filter.');
        }
        return;
    }

    setText(
        'overviewOutputValue',
        `${currentSelectors.length} selector${currentSelectors.length === 1 ? '' : 's'} ready`
    );
    setText(
        'overviewOutputHint',
        proceduralCount === 0
            ? 'Pick the most stable selector to continue.'
            : `${proceduralCount} procedural filter${proceduralCount === 1 ? '' : 's'} also generated for harder targets.`
    );
};

function setBusy(buttonId, busy, busyText) {
    const button = $(buttonId);
    if (!button) return;
    if (!button.dataset.label) {
        button.dataset.label = button.textContent;
    }
    button.disabled = busy;
    button.classList.toggle('is-busy', busy);
    button.textContent = busy ? busyText : button.dataset.label;
}

let matchCountTimer = null;

function syncFilterActions() {
    const output = $('filterOutput');
    const value = output ? output.value.trim() : '';
    const hasValue = value !== '';
    const isProcedural = /:has-text|:upward|:xpath\(|:matches-path|:matches-attr|:matches-css|:matches-media|:matches-prop|:min-text-length|:remove\(\)|:style\(|:watch-attr|:others\(\)|:not\(:has-text\(/i.test(value);

    $('btnApplyFilter').disabled = !hasValue;
    $('btnCopyFilter').disabled = !hasValue;
    $('btnTestFilter').disabled = !hasValue || (isProcedural && /:remove\(\)/.test(value));
    $('btnRemoveFilter').disabled = !isHighlighting;
    updateFilterHint();
    updateWorkflowSummary();
    updateMatchCount(value, isProcedural);
    updateCompatBadge(value);
}

function updateMatchCount(filterValue, isProcedural) {
    if (matchCountTimer !== null) { clearTimeout(matchCountTimer); }
    const badge = $('filterMatchCount');
    if (!badge) { return; }

    if (!filterValue) {
        badge.textContent = '';
        badge.removeAttribute('data-state');
        return;
    }

    matchCountTimer = setTimeout(async () => {
        if (panelClosed) { return; }
        const match = filterValue.match(/(?:##|#@#)(.+)$/);
        if (!match) { badge.textContent = ''; return; }
        const selector = match[1];

        try {
            let count;
            if (!isProcedural) {
                const code = `(function(){ try { return document.querySelectorAll(${JSON.stringify(selector)}).length; } catch(e) { return -1; } })()`;
                count = await evalInPage(code);
            } else {
                count = null;
            }
            if (panelClosed) { return; }

            if (count === null) {
                badge.textContent = 'procedural';
                badge.removeAttribute('data-state');
            } else if (count === -1) {
                badge.textContent = 'invalid';
                badge.dataset.state = 'error';
            } else if (count === 0) {
                badge.textContent = '0 matches';
                badge.dataset.state = 'zero';
            } else {
                badge.textContent = count + ' match' + (count !== 1 ? 'es' : '');
                badge.dataset.state = 'match';
            }
        } catch(_) {
            badge.textContent = '';
            badge.removeAttribute('data-state');
        }
    }, 250);
}

function updateCompatBadge(filterValue) {
    const badge = $('filterCompatBadge');
    if (!badge) { return; }

    if (!filterValue) {
        badge.textContent = '';
        badge.title = '';
        return;
    }

    const uboOnly = [':matches-path', ':matches-media', ':watch-attr', ':others()'];
    const uboAdguardBrave = [':has-text', ':upward', ':matches-attr', ':matches-css', ':remove()', ':min-text-length', ':not(:has-text'];

    const found = [];
    for (const op of uboOnly) {
        if (filterValue.includes(op)) { found.push({ op, engines: 'uBO only' }); }
    }
    for (const op of uboAdguardBrave) {
        if (filterValue.includes(op)) { found.push({ op, engines: 'uBO, AdGuard, Brave' }); }
    }

    if (found.length === 0) {
        badge.textContent = '';
        badge.title = '';
        return;
    }

    const hasUboOnly = found.some(f => f.engines === 'uBO only');
    if (hasUboOnly) {
        badge.textContent = 'uBO only';
        badge.dataset.level = 'narrow';
    } else {
        badge.textContent = 'uBO+AG+Brave';
        badge.dataset.level = 'wide';
    }
    badge.title = found.map(f => f.op + ' → ' + f.engines).join('\n');
}

function setHighlighting(state) {
    isHighlighting = state;
    syncFilterActions();
}

/******************************************************************************/

const evalInPage = (code, frameUrl) => {
    const targetFrame = frameUrl !== undefined ? frameUrl : currentFrameUrl;
    const options = targetFrame ? { frameURL: targetFrame } : undefined;
    return new Promise((resolve, reject) => {
        chrome.devtools.inspectedWindow.eval(code, options, (result, error) => {
            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        });
    });
};

/******************************************************************************/
// Filter History
/******************************************************************************/

async function loadHistory() {
    try {
        const data = await chrome.storage.local.get(HISTORY_KEY);
        filterHistory = data[HISTORY_KEY] || [];
        renderHistory();
    } catch(e) {
        filterHistory = [];
        renderHistory();
    }
}

async function saveHistory() {
    try {
        await chrome.storage.local.set({ [HISTORY_KEY]: filterHistory });
    } catch(e) {
        log('Failed to save history: ' + e, 'error');
    }
}

function addToHistory(filter, selector, hostname) {
    // Find an existing entry with the same filter text. If one exists, keep
    // its spot and just update metadata/status — this avoids the previous
    // pattern of deleting the old entry + prepending a new one (which, if
    // the persist failed mid-way, would silently drop the old record).
    const existingIdx = filterHistory.findIndex(h => h.filter === filter);
    const now = Date.now();
    if (existingIdx !== -1) {
        const existing = filterHistory[existingIdx];
        existing.selector = selector;
        existing.hostname = hostname;
        existing.timestamp = now;
        existing.active = true;
        filterHistory.splice(existingIdx, 1);
        filterHistory.unshift(existing);
    } else {
        filterHistory.unshift({
            filter,
            selector,
            hostname,
            timestamp: now,
            active: true,
        });
    }
    if (filterHistory.length > MAX_HISTORY) {
        filterHistory.length = MAX_HISTORY;
    }
    saveHistory();
    renderHistory();
}

function renderHistory() {
    const container = $('historyList');
    if (!container) return;
    while ( container.lastChild ) { container.lastChild.remove(); }

    const historySection = $('historySection');
    if (historySection) historySection.style.display = '';
    $('historyCount').textContent = filterHistory.length + ' filter' + (filterHistory.length !== 1 ? 's' : '');
    container.dataset.empty = filterHistory.length === 0 ? 'true' : 'false';

    if (filterHistory.length === 0) {
        updateWorkflowSummary();
        return;
    }

    filterHistory.slice(0, 20).forEach((entry, idx) => {
        const item = document.createElement('div');
        item.className = 'history-item' + (entry.active ? '' : ' undone');

        const filterText = document.createElement('span');
        filterText.className = 'history-filter';
        filterText.textContent = entry.filter;
        filterText.title = entry.filter;

        const time = document.createElement('span');
        time.className = 'history-time';
        const d = new Date(entry.timestamp);
        time.textContent = d.toLocaleTimeString();

        const actions = document.createElement('span');
        actions.className = 'history-actions';

        if (entry.active) {
            const undoBtn = document.createElement('button');
            undoBtn.className = 'btn-mini danger';
            undoBtn.textContent = 'Undo';
            undoBtn.addEventListener('click', () => undoFilter(idx));
            actions.appendChild(undoBtn);
        } else {
            const redoBtn = document.createElement('button');
            redoBtn.className = 'btn-mini';
            redoBtn.textContent = 'Redo';
            redoBtn.addEventListener('click', () => reapplyFilter(idx));
            actions.appendChild(redoBtn);
        }

        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn-mini';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(entry.filter);
            log('Copied: ' + entry.filter, 'success');
        });
        actions.appendChild(copyBtn);

        item.appendChild(filterText);
        item.appendChild(time);
        item.appendChild(actions);
        container.appendChild(item);
    });
    updateWorkflowSummary();
}

function unhideOnPage(selector) {
    // Strip the inline `display: none !important` we set when applying the
    // filter. This is best-effort — page may have navigated or the element
    // may no longer match — so swallow errors and return a count.
    const code = `
        (function() {
            try {
                var sel = ${JSON.stringify(selector)};
                var els = document.querySelectorAll(sel);
                for (var i = 0; i < els.length; i++) {
                    els[i].style.removeProperty('display');
                    els[i].style.removeProperty('content-visibility');
                    els[i].style.removeProperty('max-height');
                    els[i].style.removeProperty('overflow');
                }
                return els.length;
            } catch(e) { return -1; }
        })()`;
    return evalInPage(code).catch(() => -1);
}

function sendMessageAsync(msg) {
    // Promise wrapper around chrome.runtime.sendMessage. Resolves with
    // { ok: bool, response, error } instead of rejecting so callers don't
    // need try/catch around the call-and-wait.
    return new Promise(resolve => {
        try {
            chrome.runtime.sendMessage(msg, response => {
                const err = chrome.runtime.lastError;
                if (err) { resolve({ ok: false, error: err.message || String(err) }); }
                else { resolve({ ok: true, response }); }
            });
        } catch (e) {
            resolve({ ok: false, error: e && e.message || String(e) });
        }
    });
}

async function undoFilter(idx) {
    const entry = filterHistory[idx];
    if (!entry) { return; }

    const result = await sendMessageAsync({
        what: 'removeUserFilter',
        filters: entry.filter,
        docURL: currentPageUrl || undefined,
    });
    if (panelClosed) { return; }

    if (result.ok) {
        log('Filter removed from user filter list: ' + entry.filter, 'success');
    } else {
        // Fallback: un-hide elements in the page directly so the user at
        // least sees the element return. Remind them the list still holds
        // the filter.
        const count = await unhideOnPage(entry.selector);
        if (panelClosed) { return; }
        const countStr = (count === -1) ? '0' : String(count);
        log('Un-hid ' + countStr + ' element(s) on page (filter not removed from list — remove manually)', 'info');
    }

    entry.active = false;
    saveHistory();
    renderHistory();
}

async function reapplyFilter(idx) {
    const entry = filterHistory[idx];
    if (!entry) { return; }

    let persisted = false;
    try {
        const count = await evalInPage(HIDE_ELEMENT_SCRIPT(entry.selector));
        if (panelClosed) { return; }
        if (count > 0) {
            log('Re-applied: hid ' + count + ' element(s)', 'success');
        }
        persisted = await persistFilter(entry.filter);
    } catch(e) {
        log('Re-apply failed: ' + e, 'error');
    }

    if (panelClosed) { return; }
    entry.active = persisted;
    saveHistory();
    renderHistory();
}

/******************************************************************************/
// Filter Collision Detection
/******************************************************************************/

function checkFilterCollision(newFilter) {
    return new Promise(resolve => {
        try {
            chrome.runtime.sendMessage({
                what: 'getUserRules',
            }, response => {
                if (chrome.runtime.lastError || !response) {
                    resolve(null);
                    return;
                }
                const rules = (response.content || '').split('\n').filter(l => l.trim() && !l.startsWith('!'));
                const newMatch = newFilter.match(/^(.+?)(##|#@#)(.+)$/);
                if (!newMatch) { resolve(null); return; }
                const newDomain = newMatch[1];
                const newType = newMatch[2];
                const newSelector = newMatch[3];
                const collisions = [];
                for (const rule of rules) {
                    const m = rule.match(/^(.+?)(##|#@#)(.+)$/);
                    if (!m) continue;
                    const existDomain = m[1];
                    const existType = m[2];
                    const existSelector = m[3];
                    if (rule === newFilter) {
                        collisions.push({ type: 'duplicate', rule });
                    } else if (existSelector === newSelector && existType === newType) {
                        if (existDomain === '*' || existDomain === newDomain) {
                            collisions.push({ type: 'superset', rule });
                        } else if (newDomain === '*') {
                            collisions.push({ type: 'subset', rule });
                        }
                    } else if (existDomain === newDomain && existType !== newType && existSelector === newSelector) {
                        collisions.push({ type: 'conflict', rule });
                    }
                }
                resolve(collisions.length > 0 ? collisions : null);
            });
        } catch (_) {
            resolve(null);
        }
    });
}

/******************************************************************************/
// Filter Persistence via vAPI messaging
/******************************************************************************/

function persistFilter(filter) {
    return new Promise(resolve => {
        try {
            chrome.runtime.sendMessage({
                what: 'createUserFilter',
                autoComment: true,
                filters: filter,
                docURL: currentPageUrl || undefined,
            }, () => {
                if (panelClosed) { resolve(false); return; }
                if (chrome.runtime.lastError) {
                    log('Could not persist to filter list (copy and add manually)', 'info');
                    resolve(false);
                } else {
                    log('Filter persisted to user filter list', 'success');
                    resolve(true);
                }
            });
        } catch (_) {
            resolve(false);
        }
    });
}

let activeClassPatterns = DEFAULT_CLASS_PATTERNS;

/******************************************************************************/
// UI Logic
/******************************************************************************/

async function inspectSelected() {
    setStatus('Inspecting...', 'active');
    setBusy('btnInspectSelected', true, 'Inspecting...');
    log('Inspecting selected element...', 'info');

    try {
        const raw = await evalInPage(buildInspectScript(activeClassPatterns));
        if (panelClosed) { return; }
        let data;
        try {
            data = JSON.parse(raw);
        } catch (_) {
            log('Inspector payload was not valid JSON (page may have navigated mid-scan)', 'error');
            setStatus('Error', 'error');
            return;
        }

        if (!data || typeof data !== 'object') {
            log('Inspector returned no data', 'error');
            setStatus('Error', 'error');
            return;
        }

        if (data.error) {
            log(data.error, 'error');
            setStatus('Error', 'error');
            return;
        }

        // Normalize potentially-missing fields so the rest of the UI never
        // crashes on older/partial payloads.
        const selectors = Array.isArray(data.selectors) ? data.selectors : [];
        const proceduralFilters = Array.isArray(data.proceduralFilters) ? data.proceduralFilters : [];
        if (!Array.isArray(data.classes)) { data.classes = []; }
        if (!data.attrs || typeof data.attrs !== 'object') { data.attrs = {}; }
        data.selectors = selectors;
        data.proceduralFilters = proceduralFilters;

        lastInspectedData = data;
        currentHostname = (data.hostname || '').replace(/^www\./, '');
        currentPageUrl = data.pageUrl || '';
        const domainInput = $('filterDomains');
        if (domainInput && (!domainInput.value || domainInput.dataset.auto !== 'false')) {
            domainInput.value = currentHostname;
            domainInput.dataset.auto = 'true';
        }

        displayElementInfo(data);
        displaySelectors(selectors);
        displayProceduralFilters(proceduralFilters);

        const hide = id => { const el = $(id); if (el) { el.style.display = 'none'; } };
        const show = id => { const el = $(id); if (el) { el.style.display = ''; } };
        hide('emptyState');
        show('elementSection');
        show('selectorSection');
        if (proceduralFilters.length > 0) { show('proceduralSection'); }
        show('filterSection');

        setStatus('Element inspected', 'active');
        log(`Inspected <${data.tag}> - ${selectors.length} selectors, ${proceduralFilters.length} procedural filters`, 'success');
    } catch (err) {
        if (panelClosed) { return; }
        log('Inspection failed: ' + (err.message || String(err)), 'error');
        setStatus('Error', 'error');
    } finally {
        setBusy('btnInspectSelected', false);
    }
}

function displayElementInfo(data) {
    setText('elTag', '<' + (data.tag || '?') + '>');
    setText('elId', data.id || '(none)');
    setText('elClasses', data.classes.length > 0 ? data.classes.join(' ') : '(none)');

    const attrKeys = Object.keys(data.attrs);
    setText('elAttrs', attrKeys.length > 0
        ? attrKeys.map(k => k + '="' + data.attrs[k] + '"').join(', ')
        : '(none)');

    setText('elDims', data.rect ? data.rect.w + ' x ' + data.rect.h + ' px' : '--');
    setText('elVisibility', data.visibility || '--');
    setText('elPosition', data.position || '--');
    setText('elComputed', data.computed || '--');

    setText('elText', data.textContent
        ? data.textContent.substring(0, 100) + (data.textContent.length > 100 ? '...' : '')
        : '(none)');

    const selectorSummary = [data.tag || '?'];
    if (data.id) { selectorSummary.push('#' + data.id); }
    if (data.classes.length > 0) { selectorSummary.push('.' + data.classes[0]); }
    setSelectionSummary(`${selectorSummary.join('')} on ${data.hostname || 'the current page'}`);

    const shadowBadge = $('shadowBadge');
    if (shadowBadge) {
        if (data.inShadowDOM) {
            shadowBadge.style.display = '';
            if (data.shadowClosed) {
                shadowBadge.textContent = 'Closed Shadow DOM';
                shadowBadge.title = 'Host: ' + (data.shadowHost || 'unknown') + ' — closed root, only the host element can be targeted';
            } else {
                shadowBadge.textContent = 'Shadow DOM';
                shadowBadge.title = 'Host: ' + (data.shadowHost || 'unknown');
            }
        } else {
            shadowBadge.style.display = 'none';
        }
    }
}

function displaySelectors(selectors) {
    currentSelectors = selectors;
    selectedSelectorIndex = -1;

    const container = $('selectorList');
    while ( container.lastChild ) { container.lastChild.remove(); }

    $('selectorCount').textContent = selectors.length + ' selector' + (selectors.length !== 1 ? 's' : '');

    selectors.forEach((sel, idx) => {
        const item = document.createElement('div');
        item.className = 'selector-item';
        item.dataset.index = idx;

        const badge = document.createElement('span');
        badge.className = 'selector-type ' + sel.type;
        badge.textContent = sel.label;

        const text = document.createElement('span');
        text.className = 'selector-text';
        text.textContent = sel.selector;

        const count = document.createElement('span');
        count.className = 'match-count';
        count.textContent = sel.matches === -1 ? '?' : sel.matches + ' match' + (sel.matches !== 1 ? 'es' : '');

        item.appendChild(badge);
        item.appendChild(text);
        item.appendChild(count);

        item.addEventListener('click', () => selectSelector(idx));
        item.addEventListener('mouseenter', () => {
            if ($('chkLivePreview').checked && sel.matches !== -1) {
                evalInPage(HIGHLIGHT_SCRIPT(sel.selector));
            }
        });
        item.addEventListener('mouseleave', () => {
            if (!isHighlighting) {
                evalInPage(REMOVE_HIGHLIGHT_SCRIPT);
            }
        });

        container.appendChild(item);
    });

    if (selectors.length > 0) {
        selectSelector(0);
    } else {
        updateWorkflowSummary();
    }
}

function displayProceduralFilters(filters) {
    const container = $('proceduralList');
    if (!container) return;
    while ( container.lastChild ) { container.lastChild.remove(); }

    $('proceduralCount').textContent = filters.length + ' filter' + (filters.length !== 1 ? 's' : '');

    if (filters.length === 0) {
        $('proceduralSection').style.display = 'none';
        updateWorkflowSummary();
        return;
    }

    filters.forEach((pf) => {
        const item = document.createElement('div');
        item.className = 'selector-item procedural-item';

        const badge = document.createElement('span');
        badge.className = 'selector-type procedural';
        badge.textContent = pf.label;

        const content = document.createElement('div');
        content.className = 'procedural-content';

        const filterText = document.createElement('span');
        filterText.className = 'selector-text';
        filterText.textContent = pf.filter;

        const desc = document.createElement('span');
        desc.className = 'procedural-desc';
        desc.textContent = pf.description;

        content.appendChild(filterText);
        content.appendChild(desc);

        item.appendChild(badge);
        item.appendChild(content);

        item.addEventListener('click', () => {
            const hostname = currentHostname || '*';
            const fullFilter = hostname + '##' + pf.filter;
            $('filterOutput').value = fullFilter;
            log('Selected procedural filter: ' + pf.filter, 'info');
            evalInPage(REMOVE_HIGHLIGHT_SCRIPT);
            setHighlighting(false);

            // Deselect standard selectors
            document.querySelectorAll('.selector-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
            selectedSelectorIndex = -1;
            syncFilterActions();
        });

        container.appendChild(item);
    });
    updateWorkflowSummary();
}

function selectSelector(idx) {
    selectedSelectorIndex = idx;
    const sel = currentSelectors[idx];

    document.querySelectorAll('.selector-item').forEach((item, i) => {
        if (item.closest('#selectorList')) {
            item.classList.toggle('selected', i === idx);
        } else {
            item.classList.remove('selected');
        }
    });

    const filter = generateFilter(sel);
    $('filterOutput').value = filter;

    if (sel.matches !== -1) {
        evalInPage(HIGHLIGHT_SCRIPT(sel.selector));
        setHighlighting(true);
    }
    syncFilterActions();
    updateWorkflowSummary();
}

function generateFilter(sel) {
    const domainInput = $('filterDomains');
    const hostname = domainInput ? domainInput.value.trim() || '*' : (currentHostname || '*');
    const typeSelect = $('filterType');
    const filterType = typeSelect ? typeSelect.value : '##';

    if (filterType === '##-remove') {
        return hostname + '##' + sel.selector + ':remove()';
    }
    if (filterType === '##-style') {
        const styleInput = $('styleValue');
        const styleVal = styleInput ? styleInput.value.trim() : '';
        return hostname + '##' + sel.selector + ':style(' + (styleVal || 'opacity: 0 !important') + ')';
    }
    return hostname + filterType + sel.selector;
}

/******************************************************************************/
// Event Handlers
/******************************************************************************/

$('btnInspectSelected').addEventListener('click', inspectSelected);

$('btnInspectPoint').addEventListener('click', async () => {
    setStatus('Pick mode active', 'active');
    setBusy('btnInspectPoint', true, 'Pick mode active');

    if (currentFrameUrl) {
        log('Hover over an element inside the iframe and click to select. Press Escape to cancel.', 'info');
    } else {
        log('Hover over an element and click to select. Press Escape to cancel.', 'info');
    }

    try {
        const result = await evalInPage(PICK_ELEMENT_SCRIPT);
        if (result === 'already_active') {
            log('Picker already active on page', 'info');
            return;
        }
        log('Picker injected. Click an element on the page.', 'info');
        // No polling needed: the picker calls inspect(target) which fires
        // chrome.devtools.panels.elements.onSelectionChanged, and our
        // existing listener (debounced at 120ms) calls inspectSelected().
    } catch(e) {
        log('Failed to enter pick mode: ' + (e.message || e), 'error');
        setStatus('Error', 'error');
    } finally {
        setBusy('btnInspectPoint', false);
    }
});

$('btnScanShadow').addEventListener('click', async () => {
    setStatus('Scanning shadow DOM...', 'active');
    setBusy('btnScanShadow', true, 'Scanning...');
    log('Scanning for shadow DOM hosts...', 'info');
    try {
        const raw = await evalInPage(SCAN_SHADOW_SCRIPT);
        const hosts = JSON.parse(raw);
        if (hosts.length === 0) {
            log('No shadow DOM hosts found on this page', 'info');
        } else {
            log(`Found ${hosts.length} shadow DOM host(s):`, 'success');
            hosts.forEach(h => {
                log(`  ${h.host} (${h.childCount} children)`, 'info');
            });
        }
        setStatus('Scan complete', 'active');
    } catch(e) {
        log('Shadow scan failed: ' + e, 'error');
        setStatus('Error', 'error');
    } finally {
        setBusy('btnScanShadow', false);
    }
});

$('btnScanIframes').addEventListener('click', async () => {
    setStatus('Scanning iframes...', 'active');
    setBusy('btnScanIframes', true, 'Scanning...');
    log('Scanning for iframes...', 'info');
    try {
        const raw = await evalInPage(SCAN_IFRAMES_SCRIPT, ''); // force top frame
        const frames = JSON.parse(raw);
        if (frames.length === 0) {
            log('No iframes found on this page', 'info');
        } else {
            log(`Found ${frames.length} iframe(s):`, 'success');
            frames.forEach(f => {
                log(`  ${f.src} [${f.dims}] ${f.visible ? 'visible' : 'hidden'}`, 'info');
            });
        }
        // Also populate the frame dropdown
        await scanFrames();
        setStatus('Scan complete', 'active');
    } catch(e) {
        log('iframe scan failed: ' + e, 'error');
        setStatus('Error', 'error');
    } finally {
        setBusy('btnScanIframes', false);
    }
});

$('btnYtSweep').addEventListener('click', async () => {
    setBusy('btnYtSweep', true, 'Sweeping...');
    log('Running YouTube ad container sweep...', 'info');
    try {
        const raw = await evalInPage(YT_SWEEP_SCRIPT);
        const results = JSON.parse(raw);
        if (results.error) {
            log(results.error, 'error');
            return;
        }
        const found = results.filter(r => r.total > 0);
        if (found.length === 0) {
            log('No known ad containers detected on this page', 'success');
        } else {
            log(`Found ${found.length} ad container type(s):`, 'info');
            found.forEach(r => {
                const vis = r.visible > 0 ? `${r.visible} visible` : 'hidden';
                log(`  ${r.name}: ${r.total} element(s) (${vis}) — ${r.selector}`, r.visible > 0 ? 'error' : 'info');
            });
        }
        const clean = results.filter(r => r.total === 0);
        log(`${clean.length}/${results.length} container types clean`, 'success');
    } catch(e) {
        log('Sweep failed: ' + (e.message || e), 'error');
    } finally {
        setBusy('btnYtSweep', false);
    }
});

// Quick preflight: does this look like a valid CSS selector? We ask the
// browser by trying it against a detached document fragment so we don't
// pollute the inspected page. Procedural filters use uBlock-specific
// pseudo-classes (e.g. :has-text) that are *not* valid CSS and must skip
// this check — they are validated by uBlock's static filtering engine
// when the filter is parsed.
const isValidCssSelector = selector => {
    try {
        document.createDocumentFragment().querySelector(selector);
        return true;
    } catch (_) {
        return false;
    }
};

$('btnApplyFilter').addEventListener('click', async () => {
    const filter = $('filterOutput').value.trim();
    if (!filter) return;
    setBusy('btnApplyFilter', true, 'Saving...');

    const match = filter.match(/(?:##|#@#)(.+)$/);
    if (!match) {
        log('Invalid filter format — expected "domain##selector"', 'error');
        setBusy('btnApplyFilter', false);
        return;
    }

    const rawSelector = match[1];

    // Check if this is a procedural filter (contains :has-text, :upward, :matches-path, etc.)
    const isProcedural = /:has-text|:upward|:xpath\(|:matches-path|:matches-attr|:matches-css|:matches-media|:matches-prop|:min-text-length|:remove\(\)|:style\(|:watch-attr|:others\(\)|:not\(:has-text\(/.test(rawSelector);

    // Pre-flight validation for standard CSS filters only. Catches typos
    // (unbalanced brackets, stray punctuation, unknown pseudo-classes)
    // before we persist an unusable rule to the user filter list.
    if (!isProcedural && !isValidCssSelector(rawSelector)) {
        log('Invalid CSS selector — not saved. Fix the syntax and try again.', 'error');
        setBusy('btnApplyFilter', false);
        return;
    }

    // Check for collisions with existing user filters
    const collisions = await checkFilterCollision(filter);
    if (collisions) {
        for (const c of collisions) {
            if (c.type === 'duplicate') {
                log('Duplicate: this filter already exists in your list', 'error');
                setBusy('btnApplyFilter', false);
                return;
            }
            if (c.type === 'superset') {
                log('Warning: existing rule already covers this — ' + c.rule, 'info');
            } else if (c.type === 'subset') {
                log('Warning: this new rule is broader than existing — ' + c.rule, 'info');
            } else if (c.type === 'conflict') {
                log('Warning: conflicting rule type — ' + c.rule, 'info');
            }
        }
    }

    // For procedural filters, we can't use querySelectorAll to preview,
    // but uBlock will handle them natively when persisted.
    if (isProcedural) {
        log('Procedural filter detected. Persisting to uBlock...', 'info');
        const ok = await persistFilter(filter);
        if (ok) {
            addToHistory(filter, rawSelector, currentHostname);
            log('Procedural filter saved. Reload the page for it to take effect.', 'success');
        }
        setBusy('btnApplyFilter', false);
        return;
    }

    // Standard CSS filter - apply immediately + persist.
    try {
        const count = await evalInPage(HIDE_ELEMENT_SCRIPT(rawSelector));
        if (panelClosed) { return; }

        if (count > 0) {
            log(`Applied filter: hid ${count} element(s)`, 'success');
            const ok = await persistFilter(filter);
            if (ok) {
                addToHistory(filter, rawSelector, currentHostname);
            }
        } else if (count === 0) {
            log('No elements matched the selector', 'error');
        } else {
            log('Invalid selector', 'error');
        }
    } catch(e) {
        log('Failed to apply: ' + (e.message || e), 'error');
    } finally {
        setBusy('btnApplyFilter', false);
    }
});

$('btnCopyFilter').addEventListener('click', () => {
    const filter = $('filterOutput').value.trim();
    if (!filter) return;

    navigator.clipboard.writeText(filter).then(() => {
        log('Filter copied to clipboard', 'success');
        const btn = $('btnCopyFilter');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    }).catch(() => {
        log('Could not copy -- select the filter text and copy manually', 'info');
        $('filterOutput').select();
    });
});

$('btnTestFilter').addEventListener('click', async () => {
    const filter = $('filterOutput').value.trim();
    if (!filter) return;
    setBusy('btnTestFilter', true, 'Previewing...');

    const match = filter.match(/(?:##|#@#)(.+)$/);
    if (!match) {
        log('Invalid filter format', 'error');
        setBusy('btnTestFilter', false);
        return;
    }

    const selector = match[1];
    const isProcedural = /:has-text|:upward|:xpath\(|:matches-path|:matches-attr|:matches-css|:matches-media|:matches-prop|:min-text-length|:remove\(\)|:style\(|:watch-attr|:others\(\)|:not\(:has-text\(/.test(selector);

    if (isProcedural) {
        if (/:remove\(\)/.test(selector)) {
            log(':remove() cannot be previewed (irreversible). Apply to test.', 'info');
            setBusy('btnTestFilter', false);
            return;
        }
        try {
            const raw = await evalInPage(PROCEDURAL_HIGHLIGHT_SCRIPT(selector));
            if (panelClosed) { return; }
            const result = JSON.parse(raw || '{}');
            if (result.count > 0) {
                setHighlighting(true);
                log(`Preview: ${result.count} element(s) match procedural filter`, 'info');
            } else if (result.count === 0) {
                log(result.note || 'No elements match this procedural filter on the current page', 'info');
            } else {
                log(result.note || 'Could not evaluate procedural filter', 'error');
            }
        } catch(e) {
            log('Procedural preview failed: ' + (e.message || e), 'error');
        } finally {
            setBusy('btnTestFilter', false);
        }
        return;
    }

    try {
        await evalInPage(HIGHLIGHT_SCRIPT(selector));
        setHighlighting(true);
        log(`Preview: highlighting elements matching "${selector}"`, 'info');
    } catch(e) {
        log('Preview failed: ' + e, 'error');
    } finally {
        setBusy('btnTestFilter', false);
    }
});

$('btnRemoveFilter').addEventListener('click', async () => {
    try {
        await evalInPage(REMOVE_HIGHLIGHT_SCRIPT);
        setHighlighting(false);
        log('Preview removed', 'info');
    } catch(e) {
        log('Failed to remove preview: ' + e, 'error');
    }
});

$('btnTestApply').addEventListener('click', async () => {
    const filter = $('filterOutput').value.trim();
    if (!filter) return;
    const match = filter.match(/(?:##|#@#)(.+)$/);
    if (!match) { log('Invalid filter format', 'error'); return; }
    const selector = match[1];
    const isProcedural = /:has-text|:upward|:xpath\(|:matches-path|:matches-attr|:matches-css|:matches-media|:matches-prop|:min-text-length|:remove\(\)|:style\(|:watch-attr|:others\(\)|:not\(:has-text\(/.test(selector);
    if (isProcedural) {
        log('Temporary apply only works with standard CSS selectors.', 'info');
        return;
    }

    setBusy('btnTestApply', true, 'Testing...');
    try {
        const count = await evalInPage(HIDE_ELEMENT_SCRIPT(selector));
        if (panelClosed) { return; }
        if (count > 0) {
            log(`Test: hid ${count} element(s) — reverting in 5 seconds`, 'info');
            setTimeout(async () => {
                if (panelClosed) { return; }
                await unhideOnPage(selector);
                log('Test reverted', 'info');
            }, 5000);
        } else {
            log('No elements matched for test', 'info');
        }
    } catch(e) {
        log('Test failed: ' + (e.message || e), 'error');
    } finally {
        setBusy('btnTestApply', false);
    }
});

// Clear history button
const btnClearHistory = $('btnClearHistory');
if (btnClearHistory) {
    btnClearHistory.addEventListener('click', () => {
        filterHistory = [];
        saveHistory();
        renderHistory();
        log('Filter history cleared', 'info');
    });
}

const btnClearLog = $('btnClearLog');
if (btnClearLog) {
    btnClearLog.addEventListener('click', () => {
        const el = $('log');
        if (el) {
            while (el.firstChild) { el.firstChild.remove(); }
        }
        log('Activity log cleared', 'info');
    });
}

// Listen for element selection changes in the Elements panel. DevTools can
// fire this rapidly (e.g. holding arrow keys in the Elements tree); debounce
// so we don't stack up in-flight `evalInPage` calls that resolve against
// stale state.
if (chrome.devtools && chrome.devtools.panels && chrome.devtools.panels.elements) {
    let selectionChangeTimer = null;
    chrome.devtools.panels.elements.onSelectionChanged.addListener(() => {
        if (panelClosed) { return; }
        if (selectionChangeTimer !== null) { clearTimeout(selectionChangeTimer); }
        selectionChangeTimer = setTimeout(() => {
            selectionChangeTimer = null;
            if (panelClosed) { return; }
            log('Element selection changed', 'info');
            inspectSelected();
        }, 120);
    });
}

/******************************************************************************/
// Frame targeting
/******************************************************************************/

async function scanFrames() {
    try {
        // Always scan from the top frame to find all iframes
        const raw = await evalInPage(`
(function() {
    var frames = document.querySelectorAll('iframe');
    var results = [];
    for (var i = 0; i < frames.length; i++) {
        var f = frames[i];
        var src = '';
        try { src = f.src || f.contentWindow.location.href; } catch(e) { src = f.src || ''; }
        if (!src || src === 'about:blank') continue;
        results.push({
            src: src,
            id: f.id || '',
            name: f.name || '',
            dims: f.offsetWidth + 'x' + f.offsetHeight,
            visible: f.offsetParent !== null || f.offsetWidth > 0
        });
    }
    return JSON.stringify(results);
})()
`, ''); // force top frame
        const frames = JSON.parse(raw);
        const select = $('frameTarget');
        if ( !select ) { return frames; }
        const prevValue = select.value;

        // Clear all but top-frame option
        while (select.options.length > 1) select.remove(1);

        frames.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.src;
            // Build a readable label
            let label = '';
            try {
                const u = new URL(f.src);
                label = u.pathname.replace(/^\//, '').substring(0, 50) || u.hostname;
            } catch(e) {
                label = f.src.substring(0, 60);
            }
            if (f.id) label = '#' + f.id + ' - ' + label;
            else if (f.name) label = f.name + ' - ' + label;
            opt.textContent = label + ' [' + f.dims + ']';
            opt.title = f.src;
            select.appendChild(opt);
        });

        // Restore previous selection if still valid
        if (prevValue) {
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].value === prevValue) {
                    select.value = prevValue;
                    break;
                }
            }
        }

        updateWorkflowSummary();
        return frames;
    } catch(e) {
        log('Frame scan failed: ' + (e.message || e), 'error');
        return [];
    }
}

$('frameTarget').addEventListener('change', function() {
    currentFrameUrl = this.value;
    if (currentFrameUrl) {
        let label = this.options[this.selectedIndex].textContent;
        log('Targeting iframe: ' + label, 'info');
        setStatus('Frame: ' + label.substring(0, 30), 'active');
        setSelectionSummary('Inspecting inside ' + label);
    } else {
        log('Targeting top frame', 'info');
        setStatus(i18n('epStatusReady') || 'Ready');
        setSelectionSummary(i18n('epOverviewTargetHint') || 'Targeting the top document.');
    }
});

$('btnRefreshFrames').addEventListener('click', async () => {
    log('Refreshing iframe list...', 'info');
    const frames = await scanFrames();
    log('Found ' + frames.length + ' iframe(s)', frames.length > 0 ? 'success' : 'info');
});

// Handle page navigation — reset panel state. Guarded against double-install
// so reopening/reloading the panel doesn't stack listeners that fire against
// detached DOM. (The panel script is already an IIFE, but DevTools can
// recreate the panel document without reloading the background, leaving a
// prior listener alive.)
if (
    chrome.devtools &&
    chrome.devtools.inspectedWindow &&
    chrome.devtools.inspectedWindow.onNavigated &&
    !window.__elementProbe_navListenerInstalled__
) {
    window.__elementProbe_navListenerInstalled__ = true;
    const onNav = () => {
        if (panelClosed) { return; }
        lastInspectedData = null;
        currentSelectors = [];
        selectedSelectorIndex = -1;
        currentFrameUrl = '';
        isHighlighting = false;
        const hide = id => { const el = $(id); if (el) { el.style.display = 'none'; } };
        const show = id => { const el = $(id); if (el) { el.style.display = ''; } };
        show('emptyState');
        hide('elementSection');
        hide('selectorSection');
        hide('proceduralSection');
        hide('filterSection');
        const fo = $('filterOutput');
        if (fo) { fo.value = ''; }
        const select = $('frameTarget');
        if (select) {
            while (select.options.length > 1) { select.remove(1); }
            select.value = '';
        }
        setStatus(i18n('epStatusReady') || 'Ready', 'idle');
        setSelectionSummary(i18n('epNoElementSelected') || 'No element selected yet.');
        syncFilterActions();
        log('Page navigated — state reset', 'info');
        scanFrames();
        detectYouTube();
    };
    chrome.devtools.inspectedWindow.onNavigated.addListener(onNav);
}

function detectYouTube() {
    chrome.devtools.inspectedWindow.eval('location.hostname', (hostname, err) => {
        if (panelClosed || err) { return; }
        const btn = $('btnYtSweep');
        if (btn) {
            btn.style.display = hostname && hostname.includes('youtube.com') ? '' : 'none';
        }
    });
}

// Load custom class patterns from storage
chrome.storage.local.get('probeClassPatterns', result => {
    if (result.probeClassPatterns && Array.isArray(result.probeClassPatterns)) {
        activeClassPatterns = result.probeClassPatterns;
    }
});

// Initialize
loadHistory();
scanFrames(); // auto-detect iframes on panel open
detectYouTube();
syncLogState();
log('Element Probe v0.3.0 initialized', 'info');
setStatus(i18n('epStatusReady') || 'Ready');
setSelectionSummary(i18n('epNoElementSelected') || 'No element selected yet.');
syncFilterActions();

$('filterOutput').addEventListener('input', syncFilterActions);

$('filterType').addEventListener('change', () => {
    const styleRow = $('styleInputRow');
    if (styleRow) {
        styleRow.style.display = $('filterType').value === '##-style' ? 'flex' : 'none';
    }
    if (selectedSelectorIndex >= 0 && currentSelectors[selectedSelectorIndex]) {
        const filter = generateFilter(currentSelectors[selectedSelectorIndex]);
        $('filterOutput').value = filter;
    }
    syncFilterActions();
});

$('styleValue').addEventListener('input', () => {
    if ($('filterType').value === '##-style' && selectedSelectorIndex >= 0 && currentSelectors[selectedSelectorIndex]) {
        $('filterOutput').value = generateFilter(currentSelectors[selectedSelectorIndex]);
    }
});

$('filterDomains').addEventListener('input', () => {
    $('filterDomains').dataset.auto = 'false';
    if (selectedSelectorIndex >= 0 && currentSelectors[selectedSelectorIndex]) {
        $('filterOutput').value = generateFilter(currentSelectors[selectedSelectorIndex]);
    }
});
