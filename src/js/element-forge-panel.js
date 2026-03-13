/*******************************************************************************

    uBlockForge - Element Forge Panel v0.1.0

    Deep element inspection panel for Chrome DevTools.
    Generates robust CSS selectors for elements that uBlock's standard element
    picker cannot select, including shadow DOM elements, obfuscated/dynamic
    class names, YouTube live chat banners, and other stubborn elements.

    Uses chrome.devtools.inspectedWindow.eval() to access the inspected page's
    DOM with full privileges, bypassing content script limitations.

*******************************************************************************/

(function() {

const $ = id => document.getElementById(id);
const log = (msg, type = '') => {
    const el = $('log');
    const entry = document.createElement('div');
    entry.className = 'log-entry' + (type ? ' ' + type : '');
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    el.appendChild(entry);
    el.scrollTop = el.scrollHeight;
};

let currentSelectors = [];
let selectedSelectorIndex = -1;
let currentHostname = '';
let isHighlighting = false;

/******************************************************************************/

const setStatus = (text, state = '') => {
    $('statusText').textContent = text;
    const dot = $('statusDot');
    dot.className = 'status-dot';
    if (state) dot.classList.add(state);
};

/******************************************************************************/

const evalInPage = (code) => {
    return new Promise((resolve, reject) => {
        chrome.devtools.inspectedWindow.eval(code, (result, error) => {
            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        });
    });
};

/******************************************************************************/

// Core selector generation logic that runs in the inspected page context.
// This function is serialized and eval'd in the page.
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
        selectors: []
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

    // ---- Selector Generation ----

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

    // Classify classes: stable vs dynamic/obfuscated
    function classifyClasses(classes) {
        var stable = [];
        var dynamic = [];
        for (var i = 0; i < classes.length; i++) {
            var c = classes[i];
            // Dynamic/obfuscated: contains hashes, random strings, very long, starts with underscore+hex
            if (/^[a-z]{1,3}-[a-zA-Z0-9]{6,}$/.test(c) ||
                /^_[0-9a-f]{4,}/.test(c) ||
                /^[A-Z][a-zA-Z0-9]{20,}$/.test(c) ||
                /^css-[a-z0-9]+$/.test(c) ||
                /^[a-f0-9]{8,}$/.test(c) ||
                /^sc-[a-zA-Z0-9]+$/.test(c) ||
                /^emotion-[a-z0-9]+$/.test(c) ||
                /^_[A-Za-z0-9]{8,}$/.test(c) ||
                c.length > 40) {
                dynamic.push(c);
            } else {
                stable.push(c);
            }
        }
        return { stable: stable, dynamic: dynamic };
    }

    var classified = classifyClasses(result.classes);

    // 1. ID-based selector (most specific)
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

        // Just classes (no tag)
        if (classified.stable.length >= 2) {
            var justClasses = '.' + classified.stable.map(escCSS).join('.');
            var jc = countMatches(justClasses);
            if (jc > 0 && jc <= count) {
                result.selectors.push({ type: 'stable', label: 'Classes', selector: justClasses, matches: jc });
            }
        }
    }

    // 3. Attribute-based selectors (great for YouTube, dynamic sites)
    var attrKeys = Object.keys(result.attrs);
    var goodAttrs = ['data-testid', 'data-id', 'data-type', 'data-name', 'data-action',
                     'aria-label', 'aria-labelledby', 'role', 'name', 'type', 'placeholder',
                     'title', 'alt', 'data-component', 'data-widget', 'data-section',
                     'data-target', 'data-content', 'data-value', 'tabindex'];
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
        var nthChild = 0;
        for (var i = 0; i < siblings.length; i++) {
            if (siblings[i].tagName === el.tagName) nthType++;
            nthChild++;
            if (siblings[i] === el) break;
        }

        // Build parent selector
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

        // Standalone nth with tag
        var nthOnlySel = result.tag + ':nth-of-type(' + nthType + ')';
        // Only include if parent context makes it unique enough
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

    // 6. :has() based selector (parent has child pattern)
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

    // 7. Text-content based (for banners, notices, toasts)
    var text = el.textContent ? el.textContent.trim() : '';
    if (text.length > 3 && text.length < 60 && el.children.length === 0) {
        // Can't directly use text in CSS, but we note it for procedural filters
        result.textContent = text;
    }

    // 8. YouTube-specific selectors
    if (location.hostname.includes('youtube.com')) {
        // yt-live-chat elements, ytd- custom elements
        if (result.tag.startsWith('yt-') || result.tag.startsWith('ytd-')) {
            var ytSel = result.tag;
            if (classified.stable.length > 0) {
                ytSel += '.' + classified.stable.map(escCSS).join('.');
            }
            var count = countMatches(ytSel);
            result.selectors.push({ type: 'robust', label: 'YouTube', selector: ytSel, matches: count });
        }

        // Handle banner/ticket selectors in live chat
        if (el.closest('yt-live-chat-renderer') || el.closest('yt-live-chat-banner-renderer') ||
            el.closest('yt-live-chat-ticker-renderer')) {
            var chatEl = el.closest('yt-live-chat-banner-renderer') ||
                         el.closest('yt-live-chat-ticker-renderer') || el;
            var chatSel = chatEl.tagName.toLowerCase();
            var chatCount = countMatches(chatSel);
            result.selectors.push({ type: 'pierce', label: 'YT Chat', selector: chatSel, matches: chatCount });
        }
    }

    // 9. Shadow DOM piercing selector (for deep shadow elements)
    if (result.inShadowDOM && result.shadowHost) {
        // Procedural filter: shadow host ::: shadow selector
        var shadowPierce = result.shadowHost + ' /deep/ ' + result.tag;
        if (classified.stable.length > 0) {
            shadowPierce = result.shadowHost + ' /deep/ ' + result.tag + '.' + classified.stable[0];
        }
        result.selectors.push({ type: 'pierce', label: 'Shadow', selector: shadowPierce, matches: -1 });
    }

    // Sort: unique matches first, then by match count
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
    // Remove previous highlight
    var prev = document.querySelectorAll('.__ubf_highlight__');
    for (var i = 0; i < prev.length; i++) prev[i].remove();

    if (!${JSON.stringify(selector)}) return;

    try {
        var els = document.querySelectorAll(${JSON.stringify(selector)});
        for (var i = 0; i < els.length; i++) {
            var overlay = document.createElement('div');
            overlay.className = '__ubf_highlight__';
            var rect = els[i].getBoundingClientRect();
            overlay.style.cssText = 'position:fixed !important;top:' + rect.top + 'px !important;left:' + rect.left + 'px !important;width:' + rect.width + 'px !important;height:' + rect.height + 'px !important;background:rgba(137,180,250,0.25) !important;border:2px solid rgba(137,180,250,0.8) !important;pointer-events:none !important;z-index:2147483647 !important;box-sizing:border-box !important;';
            document.documentElement.appendChild(overlay);
        }
    } catch(e) {}
})()
`;

const REMOVE_HIGHLIGHT_SCRIPT = `
(function() {
    var prev = document.querySelectorAll('.__ubf_highlight__');
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

const GET_HOSTNAME_SCRIPT = `location.hostname`;

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

/******************************************************************************/
// UI Logic
/******************************************************************************/

async function inspectSelected() {
    setStatus('Inspecting...', 'active');
    log('Inspecting selected element...', 'info');

    try {
        currentHostname = await evalInPage(GET_HOSTNAME_SCRIPT);
        const raw = await evalInPage(INSPECT_SCRIPT);
        const data = JSON.parse(raw);

        if (data.error) {
            log(data.error, 'error');
            setStatus('Error', 'error');
            return;
        }

        displayElementInfo(data);
        displaySelectors(data.selectors);

        $('emptyState').style.display = 'none';
        $('elementSection').style.display = '';
        $('selectorSection').style.display = '';
        $('filterSection').style.display = '';

        setStatus('Element inspected', 'active');
        log(`Inspected <${data.tag}> - ${data.selectors.length} selectors generated`, 'success');
    } catch (err) {
        log('Inspection failed: ' + (err.message || err.value || JSON.stringify(err)), 'error');
        setStatus('Error', 'error');
    }
}

function displayElementInfo(data) {
    $('elTag').textContent = '<' + data.tag + '>';
    $('elId').textContent = data.id || '(none)';
    $('elClasses').textContent = data.classes.length > 0 ? data.classes.join(' ') : '(none)';

    const attrKeys = Object.keys(data.attrs);
    $('elAttrs').textContent = attrKeys.length > 0
        ? attrKeys.map(k => k + '="' + data.attrs[k] + '"').join(', ')
        : '(none)';

    $('elDims').textContent = data.rect ? data.rect.w + ' x ' + data.rect.h + ' px' : '--';
    $('elVisibility').textContent = data.visibility || '--';
    $('elPosition').textContent = data.position || '--';
    $('elComputed').textContent = data.computed || '--';

    if (data.inShadowDOM) {
        $('shadowBadge').style.display = '';
        $('shadowBadge').title = 'Host: ' + data.shadowHost;
    } else {
        $('shadowBadge').style.display = 'none';
    }
}

function displaySelectors(selectors) {
    currentSelectors = selectors;
    selectedSelectorIndex = -1;

    const container = $('selectorList');
    container.innerHTML = '';

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

    // Auto-select the best (first) selector
    if (selectors.length > 0) {
        selectSelector(0);
    }
}

function selectSelector(idx) {
    selectedSelectorIndex = idx;
    const sel = currentSelectors[idx];

    // Update UI
    document.querySelectorAll('.selector-item').forEach((item, i) => {
        item.classList.toggle('selected', i === idx);
    });

    // Generate cosmetic filter
    const filter = generateFilter(sel);
    $('filterOutput').value = filter;

    // Highlight
    if (sel.matches !== -1) {
        evalInPage(HIGHLIGHT_SCRIPT(sel.selector));
        isHighlighting = true;
    }
}

function generateFilter(sel) {
    const hostname = currentHostname || '*';
    const selector = sel.selector;

    // Shadow DOM piercing uses uBO procedural syntax
    if (sel.type === 'pierce') {
        return hostname + '##' + selector;
    }

    return hostname + '##' + selector;
}

/******************************************************************************/
// Event Handlers
/******************************************************************************/

$('btnInspectSelected').addEventListener('click', inspectSelected);

$('btnInspectPoint').addEventListener('click', async () => {
    log('Click an element on the page, then use Inspect Selected Element', 'info');
    setStatus('Pick element in page', 'active');
    // Trigger Chrome's inspect mode
    try {
        await evalInPage(`
            (function() {
                var handler = function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    document.removeEventListener('click', handler, true);
                    document.body.style.cursor = '';
                };
                document.addEventListener('click', handler, true);
                document.body.style.cursor = 'crosshair';
            })()
        `);
        log('Click on target element, then click "Inspect Selected Element"', 'info');
    } catch(e) {
        log('Failed to enter pick mode: ' + e, 'error');
    }
});

$('btnScanShadow').addEventListener('click', async () => {
    setStatus('Scanning shadow DOM...', 'active');
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
    }
});

$('btnScanIframes').addEventListener('click', async () => {
    setStatus('Scanning iframes...', 'active');
    log('Scanning for iframes...', 'info');
    try {
        const raw = await evalInPage(SCAN_IFRAMES_SCRIPT);
        const frames = JSON.parse(raw);
        if (frames.length === 0) {
            log('No iframes found on this page', 'info');
        } else {
            log(`Found ${frames.length} iframe(s):`, 'success');
            frames.forEach(f => {
                log(`  ${f.src} [${f.dims}] ${f.visible ? 'visible' : 'hidden'}`, 'info');
            });
        }
        setStatus('Scan complete', 'active');
    } catch(e) {
        log('iframe scan failed: ' + e, 'error');
        setStatus('Error', 'error');
    }
});

$('btnApplyFilter').addEventListener('click', async () => {
    const filter = $('filterOutput').value.trim();
    if (!filter) return;

    // Extract the CSS selector from the filter (after ##)
    const match = filter.match(/##(.+)$/);
    if (!match) {
        log('Invalid filter format', 'error');
        return;
    }

    const selector = match[1];

    // Send to uBlock's background page to create the filter
    try {
        // First, apply immediately via page injection
        const count = await evalInPage(HIDE_ELEMENT_SCRIPT(selector));

        if (count > 0) {
            log(`Applied filter: hid ${count} element(s). Filter: ${filter}`, 'success');

            // Also try to persist via uBlock's messaging system
            try {
                chrome.runtime.sendMessage({
                    what: 'createUserFilter',
                    autoComment: true,
                    filters: filter,
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        log('Filter applied to page but could not persist to filter list. Copy and add manually.', 'info');
                    } else {
                        log('Filter persisted to user filter list', 'success');
                    }
                });
            } catch(e) {
                log('Filter applied to page. Add to My Filters to persist: ' + filter, 'info');
            }
        } else if (count === 0) {
            log('No elements matched the selector', 'error');
        } else {
            log('Invalid selector', 'error');
        }
    } catch(e) {
        log('Failed to apply: ' + e, 'error');
    }
});

$('btnCopyFilter').addEventListener('click', () => {
    const filter = $('filterOutput').value.trim();
    if (!filter) return;

    navigator.clipboard.writeText(filter).then(() => {
        log('Filter copied to clipboard', 'success');
        const btn = $('btnCopyFilter');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy to Clipboard'; }, 1500);
    }).catch(() => {
        // Fallback
        $('filterOutput').select();
        document.execCommand('copy');
        log('Filter copied to clipboard (fallback)', 'success');
    });
});

$('btnTestFilter').addEventListener('click', async () => {
    const filter = $('filterOutput').value.trim();
    if (!filter) return;

    const match = filter.match(/##(.+)$/);
    if (!match) {
        log('Invalid filter format', 'error');
        return;
    }

    const selector = match[1];
    try {
        await evalInPage(HIGHLIGHT_SCRIPT(selector));
        isHighlighting = true;
        log(`Preview: highlighting elements matching "${selector}"`, 'info');
    } catch(e) {
        log('Preview failed: ' + e, 'error');
    }
});

$('btnRemoveFilter').addEventListener('click', async () => {
    try {
        await evalInPage(REMOVE_HIGHLIGHT_SCRIPT);
        isHighlighting = false;
        log('Preview removed', 'info');
    } catch(e) {
        log('Failed to remove preview: ' + e, 'error');
    }
});

// Listen for element selection changes in the Elements panel
if (chrome.devtools && chrome.devtools.panels && chrome.devtools.panels.elements) {
    chrome.devtools.panels.elements.onSelectionChanged.addListener(() => {
        log('Element selection changed in Elements panel', 'info');
        // Auto-inspect if the panel is visible
        inspectSelected();
    });
}

// Initialize
log('Element Forge panel initialized', 'info');
setStatus('Ready');

})();
