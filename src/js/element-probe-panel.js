/*******************************************************************************

    uBlockVanced - Element Probe Panel v0.2.6

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

(function() {

const $ = id => document.getElementById(id);

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
    const isProcedural = /:has-text|:upward|:matches-path|:not\(:has-text\(/i.test(value);

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
        text = 'Procedural rules save directly to your filters. In-page preview is unavailable for this rule type.';
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
    const isProcedural = /:has-text|:upward|:matches-path|:not\(:has-text\(/i.test($('filterOutput')?.value || '');

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

function syncFilterActions() {
    const output = $('filterOutput');
    const value = output ? output.value.trim() : '';
    const hasValue = value !== '';
    const isProcedural = /:has-text|:upward|:matches-path|:not\(:has-text\(/i.test(value);

    $('btnApplyFilter').disabled = !hasValue;
    $('btnCopyFilter').disabled = !hasValue;
    $('btnTestFilter').disabled = !hasValue || isProcedural;
    $('btnRemoveFilter').disabled = !isHighlighting;
    updateFilterHint();
    updateWorkflowSummary();
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

    try {
        const count = await evalInPage(HIDE_ELEMENT_SCRIPT(entry.selector));
        if (panelClosed) { return; }
        if (count > 0) {
            log('Re-applied: hid ' + count + ' element(s)', 'success');
        }
        // Wait for the persist round-trip so the history state matches
        // what was actually written to the user filter list.
        await persistFilter(entry.filter);
    } catch(e) {
        log('Re-apply failed: ' + e, 'error');
    }

    if (panelClosed) { return; }
    entry.active = true;
    saveHistory();
    renderHistory();
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

/******************************************************************************/
// Core inspection script - runs in the inspected page context
/******************************************************************************/

const INSPECT_SCRIPT = `
(function() {
    var el = $0;
    if (!el) return JSON.stringify({ error: 'No element selected. Select one in the Elements panel.' });

    var result = {
        tag: el.tagName ? el.tagName.toLowerCase() : '',
        id: el.id || '',
        classes: el.className && typeof el.className === 'string' ? el.className.split(/\\s+/).filter(Boolean) : [],
        attrs: {},
        rect: null,
        visibility: '',
        position: '',
        computed: '',
        inShadowDOM: false,
        shadowHost: '',
        selectors: [],
        proceduralFilters: [],
        textContent: '',
        parentText: '',
        pageUrl: location.href,
        hostname: location.hostname
    };

    // Gather attributes (skip class/id/style)
    if (el.attributes) {
        for (var i = 0; i < el.attributes.length; i++) {
            var attr = el.attributes[i];
            if (attr.name !== 'class' && attr.name !== 'id' && attr.name !== 'style') {
                result.attrs[attr.name] = attr.value;
            }
        }
    }

    // Dimensions and position
    var rect = el.getBoundingClientRect();
    result.rect = { w: Math.round(rect.width), h: Math.round(rect.height) };

    var cs = getComputedStyle(el);
    result.visibility = cs.display + ' / ' + cs.visibility + (cs.opacity !== '1' ? ' / opacity:' + cs.opacity : '');
    result.position = cs.position + (cs.zIndex !== 'auto' ? ' z:' + cs.zIndex : '');
    result.computed = 'bg:' + cs.backgroundColor + (cs.backgroundImage !== 'none' ? ' +img' : '');

    // Text content for procedural filters
    var directText = '';
    for (var i = 0; i < el.childNodes.length; i++) {
        if (el.childNodes[i].nodeType === 3) {
            directText += el.childNodes[i].textContent;
        }
    }
    directText = directText.trim();
    result.textContent = directText || (el.textContent ? el.textContent.trim().substring(0, 200) : '');

    // Parent text content (for :upward targeting)
    if (el.parentElement && el.parentElement !== document.body) {
        var parentDirect = '';
        for (var i = 0; i < el.parentElement.childNodes.length; i++) {
            if (el.parentElement.childNodes[i].nodeType === 3) {
                parentDirect += el.parentElement.childNodes[i].textContent;
            }
        }
        result.parentText = parentDirect.trim().substring(0, 200);
    }

    // Check shadow DOM
    var node = el;
    while (node) {
        if (node instanceof ShadowRoot) {
            result.inShadowDOM = true;
            if (node.host) {
                result.shadowHost = node.host.tagName.toLowerCase() +
                    (node.host.id ? '#' + node.host.id : '') +
                    (node.host.className && typeof node.host.className === 'string' ? '.' + node.host.className.split(/\\s+/).join('.') : '');
            }
            break;
        }
        node = node.parentNode;
    }

    // ---- Helper functions ----

    function escCSS(str) {
        return CSS.escape ? CSS.escape(str) : str.replace(/([\\[\\](){}|:.\\\\/^$*+?#])/g, '\\\\$1');
    }

    function countMatches(sel) {
        try {
            return document.querySelectorAll(sel).length;
        } catch(e) {
            return -1;
        }
    }

    function classifyClasses(classes) {
        var stable = [];
        var dynamic = [];
        for (var i = 0; i < classes.length; i++) {
            var c = classes[i];
            if (/^[a-z]{1,3}-[a-zA-Z0-9]{6,}$/.test(c) ||
                /^_[0-9a-f]{4,}/.test(c) ||
                /^[A-Z][a-zA-Z0-9]{20,}$/.test(c) ||
                /^css-[a-z0-9]+$/.test(c) ||
                /^[a-f0-9]{8,}$/.test(c) ||
                /^sc-[a-zA-Z0-9]+$/.test(c) ||
                /^emotion-[a-z0-9]+$/.test(c) ||
                /^_[A-Za-z0-9]{8,}$/.test(c) ||
                /^styled-[a-z0-9]+$/.test(c) ||
                /^[a-z]{1,2}[A-Z][a-zA-Z0-9]{10,}$/.test(c) ||
                c.length > 40) {
                dynamic.push(c);
            } else {
                stable.push(c);
            }
        }
        return { stable: stable, dynamic: dynamic };
    }

    function escRegex(str) {
        return str.replace(/[.*+?^()|[\\]\\\\$]/g, '\\\\$&');
    }

    var classified = classifyClasses(result.classes);

    // ---- Standard CSS Selector Generation ----

    // 1. ID-based selector
    if (result.id) {
        var idSel = '#' + escCSS(result.id);
        var count = countMatches(idSel);
        if (count === 1) {
            result.selectors.push({ type: 'stable', label: 'ID', selector: idSel, matches: count });
        }
    }

    // 2. Tag + stable classes
    if (classified.stable.length > 0) {
        var tagClass = result.tag + '.' + classified.stable.map(escCSS).join('.');
        var count = countMatches(tagClass);
        result.selectors.push({ type: 'stable', label: 'Tag+Class', selector: tagClass, matches: count });

        if (classified.stable.length >= 2) {
            var justClasses = '.' + classified.stable.map(escCSS).join('.');
            var jc = countMatches(justClasses);
            if (jc > 0 && jc <= count) {
                result.selectors.push({ type: 'stable', label: 'Classes', selector: justClasses, matches: jc });
            }
        }
    }

    // 3. Attribute-based selectors
    var attrKeys = Object.keys(result.attrs);
    var goodAttrs = ['data-testid', 'data-id', 'data-type', 'data-name', 'data-action',
                     'aria-label', 'aria-labelledby', 'role', 'name', 'type', 'placeholder',
                     'title', 'alt', 'data-component', 'data-widget', 'data-section',
                     'data-target', 'data-content', 'data-value', 'tabindex',
                     'is', 'slot', 'part'];
    for (var i = 0; i < attrKeys.length; i++) {
        var key = attrKeys[i];
        var val = result.attrs[key];
        if (goodAttrs.indexOf(key) !== -1 || key.startsWith('data-')) {
            var attrSel;
            if (val && val.length < 80) {
                attrSel = result.tag + '[' + key + '="' + val.replace(/"/g, '\\\\"') + '"]';
            } else {
                attrSel = result.tag + '[' + key + ']';
            }
            var count = countMatches(attrSel);
            if (count > 0 && count <= 20) {
                result.selectors.push({ type: 'attrs', label: 'Attribute', selector: attrSel, matches: count });
            }
        }
    }

    // 4. nth-of-type / nth-child based
    if (el.parentElement) {
        var siblings = el.parentElement.children;
        var nthType = 0;
        for (var i = 0; i < siblings.length; i++) {
            if (siblings[i].tagName === el.tagName) nthType++;
            if (siblings[i] === el) break;
        }

        var parentSel = '';
        if (el.parentElement.id) {
            parentSel = '#' + escCSS(el.parentElement.id);
        } else if (el.parentElement.className && typeof el.parentElement.className === 'string') {
            var pClasses = classifyClasses(el.parentElement.className.split(/\\s+/).filter(Boolean));
            if (pClasses.stable.length > 0) {
                parentSel = el.parentElement.tagName.toLowerCase() + '.' + pClasses.stable.map(escCSS).join('.');
            }
        }

        if (parentSel) {
            var nthSel = parentSel + ' > ' + result.tag + ':nth-of-type(' + nthType + ')';
            var count = countMatches(nthSel);
            if (count > 0 && count <= 5) {
                result.selectors.push({ type: 'nth', label: 'Structural', selector: nthSel, matches: count });
            }
        }
    }

    // 5. Deep structural selector (walk up the tree)
    var path = [];
    var current = el;
    var depth = 0;
    while (current && current !== document.body && depth < 5) {
        var part = current.tagName.toLowerCase();
        if (current.id) {
            part = '#' + escCSS(current.id);
            path.unshift(part);
            break;
        }
        var cInfo = classifyClasses(
            current.className && typeof current.className === 'string'
            ? current.className.split(/\\s+/).filter(Boolean) : []
        );
        if (cInfo.stable.length > 0) {
            part += '.' + cInfo.stable.slice(0, 2).map(escCSS).join('.');
        }
        path.unshift(part);
        current = current.parentElement;
        depth++;
    }
    if (path.length >= 2) {
        var deepSel = path.join(' > ');
        var count = countMatches(deepSel);
        if (count > 0 && count <= 10) {
            result.selectors.push({ type: 'deep', label: 'Path', selector: deepSel, matches: count });
        }
    }

    // 6. :has() based selector
    if (el.children.length > 0) {
        var firstChild = el.children[0];
        var childTag = firstChild.tagName.toLowerCase();
        var childInfo = classifyClasses(
            firstChild.className && typeof firstChild.className === 'string'
            ? firstChild.className.split(/\\s+/).filter(Boolean) : []
        );
        var childSel = childTag;
        if (firstChild.id) {
            childSel = '#' + escCSS(firstChild.id);
        } else if (childInfo.stable.length > 0) {
            childSel += '.' + childInfo.stable[0];
        }

        var hasSel = result.tag + (classified.stable.length > 0 ? '.' + escCSS(classified.stable[0]) : '') + ':has(> ' + childSel + ')';
        var count = countMatches(hasSel);
        if (count > 0 && count <= 5) {
            result.selectors.push({ type: 'robust', label: ':has()', selector: hasSel, matches: count });
        }
    }

    // 7. YouTube-specific selectors
    if (location.hostname.includes('youtube.com')) {
        if (result.tag.startsWith('yt-') || result.tag.startsWith('ytd-')) {
            var ytSel = result.tag;
            if (classified.stable.length > 0) {
                ytSel += '.' + classified.stable.map(escCSS).join('.');
            }
            var count = countMatches(ytSel);
            result.selectors.push({ type: 'robust', label: 'YouTube', selector: ytSel, matches: count });
        }

        if (el.closest('yt-live-chat-renderer') || el.closest('yt-live-chat-banner-renderer') ||
            el.closest('yt-live-chat-ticker-renderer')) {
            var chatEl = el.closest('yt-live-chat-banner-renderer') ||
                         el.closest('yt-live-chat-ticker-renderer') || el;
            var chatSel = chatEl.tagName.toLowerCase();
            var chatCount = countMatches(chatSel);
            result.selectors.push({ type: 'pierce', label: 'YT Chat', selector: chatSel, matches: chatCount });
        }
    }

    // 8. Shadow DOM piercing selector
    if (result.inShadowDOM && result.shadowHost) {
        var shadowPierce = result.shadowHost + ' /deep/ ' + result.tag;
        if (classified.stable.length > 0) {
            shadowPierce = result.shadowHost + ' /deep/ ' + result.tag + '.' + classified.stable[0];
        }
        result.selectors.push({ type: 'pierce', label: 'Shadow', selector: shadowPierce, matches: -1 });
    }

    // ---- Procedural Cosmetic Filter Generation ----

    // :has-text() - match elements containing specific text
    var textForFilter = directText || result.textContent;
    if (textForFilter && textForFilter.length >= 3 && textForFilter.length <= 120) {
        var baseSel = result.tag;
        if (classified.stable.length > 0) {
            baseSel += '.' + escCSS(classified.stable[0]);
        }

        // Exact text match (for short, unique text)
        if (textForFilter.length <= 60) {
            result.proceduralFilters.push({
                type: 'has-text',
                label: ':has-text()',
                filter: baseSel + ':has-text(' + textForFilter + ')',
                description: 'Match elements containing "' + textForFilter.substring(0, 40) + (textForFilter.length > 40 ? '...' : '') + '"'
            });
        }

        // Regex text match (for partial/flexible matching)
        if (textForFilter.length > 8) {
            var words = textForFilter.split(/\\s+/).filter(function(w) { return w.length > 3; });
            if (words.length >= 2) {
                var regexParts = words.slice(0, 3).map(escRegex);
                var regexFilter = baseSel + ':has-text(/' + regexParts.join('.*') + '/i)';
                result.proceduralFilters.push({
                    type: 'has-text',
                    label: ':has-text(regex)',
                    filter: regexFilter,
                    description: 'Regex match key words from element text'
                });
            }
        }
    }

    // :upward() - target ancestor elements from a known child
    if (el.parentElement && el.parentElement !== document.body) {
        // :upward(N) - walk up N levels
        for (var n = 1; n <= 3; n++) {
            var ancestor = el;
            for (var j = 0; j < n; j++) {
                if (ancestor.parentElement && ancestor.parentElement !== document.body) {
                    ancestor = ancestor.parentElement;
                } else {
                    ancestor = null;
                    break;
                }
            }
            if (!ancestor) break;

            var ancTag = ancestor.tagName.toLowerCase();
            var ancClasses = classifyClasses(
                ancestor.className && typeof ancestor.className === 'string'
                ? ancestor.className.split(/\\s+/).filter(Boolean) : []
            );
            var ancDesc = ancTag;
            if (ancestor.id) ancDesc = ancTag + '#' + ancestor.id;
            else if (ancClasses.stable.length > 0) ancDesc = ancTag + '.' + ancClasses.stable[0];

            // Only add if we have a good child selector to start from
            var childBase = result.tag;
            if (classified.stable.length > 0) {
                childBase += '.' + escCSS(classified.stable[0]);
            } else if (result.id) {
                childBase = '#' + escCSS(result.id);
            } else {
                continue;
            }

            result.proceduralFilters.push({
                type: 'upward',
                label: ':upward(' + n + ')',
                filter: childBase + ':upward(' + n + ')',
                description: 'Select ' + ancDesc + ' (' + n + ' level' + (n > 1 ? 's' : '') + ' up)'
            });

            // :upward(selector) - walk up to matching ancestor
            if (ancClasses.stable.length > 0 || ancestor.id) {
                var upSel = ancestor.id ? '#' + escCSS(ancestor.id) : ancTag + '.' + escCSS(ancClasses.stable[0]);
                result.proceduralFilters.push({
                    type: 'upward',
                    label: ':upward(sel)',
                    filter: childBase + ':upward(' + upSel + ')',
                    description: 'Walk up to ' + upSel
                });
            }
        }
    }

    // :matches-path() - restrict filter to specific URL paths
    var urlPath = location.pathname;
    if (urlPath && urlPath !== '/') {
        var pathParts = urlPath.split('/').filter(Boolean);
        if (pathParts.length >= 1) {
            var baseSel = result.tag;
            if (classified.stable.length > 0) {
                baseSel += '.' + escCSS(classified.stable[0]);
            } else if (result.id) {
                baseSel = '#' + escCSS(result.id);
            }

            // Exact path match
            result.proceduralFilters.push({
                type: 'matches-path',
                label: ':matches-path()',
                filter: baseSel + ':matches-path(' + escRegex(urlPath) + ')',
                description: 'Only on path: ' + urlPath
            });

            // Partial path (first segment)
            if (pathParts.length > 1) {
                result.proceduralFilters.push({
                    type: 'matches-path',
                    label: ':matches-path(partial)',
                    filter: baseSel + ':matches-path(/' + escRegex(pathParts[0]) + '/)',
                    description: 'On paths containing /' + pathParts[0] + '/'
                });
            }
        }
    }

    // :not(:has-text()) - exclude elements with specific text (inverse match)
    if (textForFilter && textForFilter.length >= 3 && textForFilter.length <= 60) {
        var baseSel = result.tag;
        if (classified.stable.length > 0) {
            baseSel += '.' + escCSS(classified.stable[0]);
        }
        result.proceduralFilters.push({
            type: 'not-has-text',
            label: ':not(:has-text())',
            filter: baseSel + ':not(:has-text(' + textForFilter + '))',
            description: 'Match all ' + baseSel + ' EXCEPT those containing this text'
        });
    }

    // YouTube-specific procedural filters
    if (location.hostname.includes('youtube.com')) {
        // Banner in live chat - these change class names but keep tag structure
        if (el.closest('yt-live-chat-banner-renderer')) {
            var bannerText = el.closest('yt-live-chat-banner-renderer').textContent.trim().substring(0, 80);
            if (bannerText) {
                result.proceduralFilters.push({
                    type: 'has-text',
                    label: 'YT Banner :has-text()',
                    filter: 'yt-live-chat-banner-renderer:has-text(' + bannerText.substring(0, 40) + ')',
                    description: 'Hide this live chat banner by its text content'
                });
            }
            result.proceduralFilters.push({
                type: 'upward',
                label: 'YT Banner :upward()',
                filter: result.tag + ':upward(yt-live-chat-banner-renderer)',
                description: 'Walk up to the banner renderer from this child element'
            });
        }

        // Ticker items in live chat
        if (el.closest('yt-live-chat-ticker-renderer')) {
            result.proceduralFilters.push({
                type: 'upward',
                label: 'YT Ticker :upward()',
                filter: result.tag + ':upward(yt-live-chat-ticker-renderer)',
                description: 'Walk up to the ticker renderer from this child element'
            });
        }

        // ytd- elements with obfuscated classes
        if (result.tag.startsWith('ytd-') && classified.dynamic.length > 0 && classified.stable.length === 0) {
            result.proceduralFilters.push({
                type: 'has-text',
                label: 'YT :has-text()',
                filter: result.tag + ':has-text(' + (textForFilter || '').substring(0, 40) + ')',
                description: 'Target obfuscated YT element by text (classes are dynamic)'
            });
        }
    }

    // Sort standard selectors
    result.selectors.sort(function(a, b) {
        if (a.matches === 1 && b.matches !== 1) return -1;
        if (b.matches === 1 && a.matches !== 1) return 1;
        if (a.matches === -1) return 1;
        if (b.matches === -1) return -1;
        return a.matches - b.matches;
    });

    return JSON.stringify(result);
})()
`;

/******************************************************************************/

const HIGHLIGHT_SCRIPT = (selector) => `
(function() {
    var prev = document.querySelectorAll('.__ubp_highlight__');
    for (var i = 0; i < prev.length; i++) prev[i].remove();

    if (!${JSON.stringify(selector)}) return;

    try {
        var els = document.querySelectorAll(${JSON.stringify(selector)});
        for (var i = 0; i < els.length; i++) {
            var overlay = document.createElement('div');
            overlay.className = '__ubp_highlight__';
            var rect = els[i].getBoundingClientRect();
            overlay.style.cssText = 'position:fixed !important;top:' + rect.top + 'px !important;left:' + rect.left + 'px !important;width:' + rect.width + 'px !important;height:' + rect.height + 'px !important;background:rgba(137,180,250,0.25) !important;border:2px solid rgba(137,180,250,0.8) !important;pointer-events:none !important;z-index:2147483647 !important;box-sizing:border-box !important;transition:opacity 150ms ease !important;';
            document.documentElement.appendChild(overlay);
        }
    } catch(e) {}
})()
`;

const REMOVE_HIGHLIGHT_SCRIPT = `
(function() {
    var prev = document.querySelectorAll('.__ubp_highlight__');
    for (var i = 0; i < prev.length; i++) prev[i].remove();
})()
`;

const HIDE_ELEMENT_SCRIPT = (selector) => `
(function() {
    try {
        var els = document.querySelectorAll(${JSON.stringify(selector)});
        for (var i = 0; i < els.length; i++) {
            els[i].style.setProperty('display', 'none', 'important');
        }
        return els.length;
    } catch(e) {
        return -1;
    }
})()
`;

const SCAN_SHADOW_SCRIPT = `
(function() {
    var results = [];
    function walk(node, depth) {
        if (depth > 10) return;
        if (node.shadowRoot) {
            results.push({
                host: node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') +
                      (node.className && typeof node.className === 'string' ? '.' + node.className.split(/\\s+/).filter(Boolean).join('.') : ''),
                childCount: node.shadowRoot.children.length
            });
            walk(node.shadowRoot, depth + 1);
        }
        var children = node.children || node.childNodes;
        for (var i = 0; i < children.length; i++) {
            if (children[i].nodeType === 1) walk(children[i], depth + 1);
        }
    }
    walk(document.documentElement, 0);
    return JSON.stringify(results);
})()
`;

const SCAN_IFRAMES_SCRIPT = `
(function() {
    var frames = document.querySelectorAll('iframe');
    var results = [];
    for (var i = 0; i < frames.length; i++) {
        results.push({
            src: frames[i].src || '(no src)',
            id: frames[i].id || '',
            classes: frames[i].className || '',
            visible: frames[i].offsetParent !== null,
            dims: frames[i].offsetWidth + 'x' + frames[i].offsetHeight
        });
    }
    return JSON.stringify(results);
})()
`;

// Pick from Page: inject a visual element picker that highlights on hover
// and sets $0 via inspect() when clicked
const PICK_ELEMENT_SCRIPT = `
(function() {
    if (window.__ubp_picker_active__) return 'already_active';

    window.__ubp_picker_active__ = true;
    var overlay = document.createElement('div');
    overlay.id = '__ubp_picker_overlay__';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483646;cursor:crosshair;pointer-events:none;';
    document.documentElement.appendChild(overlay);

    var highlight = document.createElement('div');
    highlight.id = '__ubp_picker_highlight__';
    highlight.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid rgba(203,166,247,0.9);background:rgba(203,166,247,0.15);transition:all 80ms ease;display:none;';
    document.documentElement.appendChild(highlight);

    var label = document.createElement('div');
    label.id = '__ubp_picker_label__';
    label.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#1e1e2e;color:#cdd6f4;font:11px/1.4 monospace;padding:4px 8px;border-radius:4px;border:1px solid #45475a;display:none;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    document.documentElement.appendChild(label);

    function onMove(e) {
        var target = document.elementFromPoint(e.clientX, e.clientY);
        if (!target || target === overlay || target === highlight || target === label) return;
        var rect = target.getBoundingClientRect();
        highlight.style.display = 'block';
        highlight.style.top = rect.top + 'px';
        highlight.style.left = rect.left + 'px';
        highlight.style.width = rect.width + 'px';
        highlight.style.height = rect.height + 'px';

        var desc = target.tagName.toLowerCase();
        if (target.id) desc += '#' + target.id;
        else if (target.className && typeof target.className === 'string') {
            var cls = target.className.split(/\\s+/).filter(Boolean).slice(0, 3).join('.');
            if (cls) desc += '.' + cls;
        }
        label.textContent = desc + ' (' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ')';
        label.style.display = 'block';
        label.style.top = Math.max(0, rect.top - 28) + 'px';
        label.style.left = rect.left + 'px';
    }

    function onClick(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        var target = document.elementFromPoint(e.clientX, e.clientY);
        cleanup();

        if (target) {
            // inspect() sets $0 in DevTools
            inspect(target);
        }
        return false;
    }

    function onKeydown(e) {
        if (e.key === 'Escape') {
            cleanup();
        }
    }

    function cleanup() {
        window.__ubp_picker_active__ = false;
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKeydown, true);
        var o = document.getElementById('__ubp_picker_overlay__');
        var h = document.getElementById('__ubp_picker_highlight__');
        var l = document.getElementById('__ubp_picker_label__');
        if (o) o.remove();
        if (h) h.remove();
        if (l) l.remove();
    }

    // Delay pointer-events to avoid capturing the triggering click
    setTimeout(function() {
        overlay.style.pointerEvents = 'auto';
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKeydown, true);
    }, 100);

    return 'picker_started';
})()
`;

/******************************************************************************/
// UI Logic
/******************************************************************************/

async function inspectSelected() {
    setStatus('Inspecting...', 'active');
    setBusy('btnInspectSelected', true, 'Inspecting...');
    log('Inspecting selected element...', 'info');

    try {
        const raw = await evalInPage(INSPECT_SCRIPT);
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
        currentHostname = data.hostname || '';
        currentPageUrl = data.pageUrl || '';

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
            shadowBadge.title = 'Host: ' + (data.shadowHost || 'unknown');
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
    const hostname = currentHostname || '*';
    return hostname + '##' + sel.selector;
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

        // Poll for when picker sets $0 (element selected)
        const pollForSelection = setInterval(async () => {
            try {
                const active = await evalInPage('!!window.__ubp_picker_active__');
                if (!active) {
                    clearInterval(pollForSelection);
                    // Small delay for inspect() to propagate $0
                    setTimeout(() => {
                        inspectSelected();
                    }, 200);
                }
            } catch(e) {
                clearInterval(pollForSelection);
            }
        }, 300);

        // Stop polling after 30s
        setTimeout(() => clearInterval(pollForSelection), 30000);
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

    const match = filter.match(/##(.+)$/);
    if (!match) {
        log('Invalid filter format — expected "domain##selector"', 'error');
        setBusy('btnApplyFilter', false);
        return;
    }

    const rawSelector = match[1];

    // Check if this is a procedural filter (contains :has-text, :upward, :matches-path, etc.)
    const isProcedural = /:has-text|:upward|:matches-path|:not\(:has-text\(/.test(rawSelector);

    // Pre-flight validation for standard CSS filters only. Catches typos
    // (unbalanced brackets, stray punctuation, unknown pseudo-classes)
    // before we persist an unusable rule to the user filter list.
    if (!isProcedural && !isValidCssSelector(rawSelector)) {
        log('Invalid CSS selector — not saved. Fix the syntax and try again.', 'error');
        setBusy('btnApplyFilter', false);
        return;
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

    const match = filter.match(/##(.+)$/);
    if (!match) {
        log('Invalid filter format', 'error');
        setBusy('btnTestFilter', false);
        return;
    }

    const selector = match[1];
    const isProcedural = /:has-text|:upward|:matches-path|:not\(:has-text\(/.test(selector);

    if (isProcedural) {
        log('Procedural filters cannot be previewed in-page. Apply to test.', 'info');
        setBusy('btnTestFilter', false);
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
        setStatus('Ready');
        setSelectionSummary('Targeting the top document.');
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
        setStatus('Page navigated', 'idle');
        setSelectionSummary('No element selected yet.');
        syncFilterActions();
        log('Page navigated — state reset', 'info');
        scanFrames();
    };
    chrome.devtools.inspectedWindow.onNavigated.addListener(onNav);
}

// Initialize
loadHistory();
scanFrames(); // auto-detect iframes on panel open
syncLogState();
log('Element Probe v0.2.6 initialized', 'info');
setStatus('Ready');
setSelectionSummary('No element selected yet.');
syncFilterActions();

$('filterOutput').addEventListener('input', syncFilterActions);

})();
