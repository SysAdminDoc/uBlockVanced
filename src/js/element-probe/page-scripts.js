/*******************************************************************************

    uBlockVanced — Element Probe: Page-Context Scripts

    Pure string-template functions that generate JavaScript to be injected into
    the inspected page via chrome.devtools.inspectedWindow.eval().  These
    templates have NO DOM access of their own — they produce source text that
    runs inside the page context.

*******************************************************************************/

/******************************************************************************/
// Core inspection script - runs in the inspected page context
/******************************************************************************/

export const DEFAULT_CLASS_PATTERNS = [
    '^[a-z]{1,3}-[a-zA-Z0-9]{6,}$',
    '^_[0-9a-f]{4,}',
    '^[A-Z][a-zA-Z0-9]{20,}$',
    '^css-[a-z0-9]+$',
    '^[a-f0-9]{8,}$',
    '^sc-[a-zA-Z0-9]+$',
    '^emotion-[a-z0-9]+$',
    '^_[A-Za-z0-9]{8,}$',
    '^styled-[a-z0-9]+$',
    '^[a-z]{1,2}[A-Z][a-zA-Z0-9]{10,}$',
];

export function buildInspectScript(patterns) {
    const patternsJson = JSON.stringify(patterns);
    return `
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
        shadowClosed: false,
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

    var DYNAMIC_PATTERNS = ${patternsJson}.map(function(p) { return new RegExp(p); });
    function classifyClasses(classes) {
        var stable = [];
        var dynamic = [];
        for (var i = 0; i < classes.length; i++) {
            var c = classes[i];
            var isDynamic = c.length > 40;
            if (!isDynamic) {
                for (var pi = 0; pi < DYNAMIC_PATTERNS.length; pi++) {
                    if (DYNAMIC_PATTERNS[pi].test(c)) { isDynamic = true; break; }
                }
            }
            if (isDynamic) { dynamic.push(c); } else { stable.push(c); }
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

    // 8. Shadow DOM selectors
    if (result.inShadowDOM && result.shadowHost) {
        // Determine if the shadow root is open (pierceable) or closed
        var shadowNode = el;
        var shadowRoot = null;
        while (shadowNode) {
            if (shadowNode instanceof ShadowRoot) { shadowRoot = shadowNode; break; }
            shadowNode = shadowNode.parentNode;
        }
        var isOpen = shadowRoot && shadowRoot.host && shadowRoot.host.shadowRoot === shadowRoot;

        if (isOpen) {
            // Open shadow root: uBO's content scripts can walk into it via
            // element.shadowRoot recursion. Generate the inner selector
            // relative to the shadow host so the user knows the path.
            var innerSel = result.tag;
            if (classified.stable.length > 0) {
                innerSel += '.' + escCSS(classified.stable[0]);
            }
            result.selectors.push({
                type: 'pierce',
                label: 'Shadow (open)',
                selector: innerSel,
                matches: -1
            });
            // Also offer the host selector itself for hiding the entire component
            var hostCount = countMatches(result.shadowHost);
            result.selectors.push({
                type: 'pierce',
                label: 'Shadow host',
                selector: result.shadowHost,
                matches: hostCount
            });
        } else {
            // Closed shadow root: not pierceable by content scripts.
            // The only viable strategy is to target the host element.
            var hostCount = countMatches(result.shadowHost);
            result.selectors.push({
                type: 'pierce',
                label: 'Shadow (closed)',
                selector: result.shadowHost,
                matches: hostCount
            });
            result.shadowClosed = true;
        }
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

    // :matches-path() - restrict filter to specific URL paths
    var pagePath = location.pathname;
    if (pagePath && pagePath !== '/' && result.selectors.length > 0) {
        var pathBase = result.selectors[0].selector;
        var escapedPath = pagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result.proceduralFilters.push({
            type: 'matches-path',
            label: ':matches-path()',
            filter: pathBase + ':matches-path(' + escapedPath + ')',
            description: 'Only apply on pages matching ' + pagePath
        });
        var pathDir = pagePath.replace(/\/[^/]*$/, '/');
        if (pathDir !== pagePath && pathDir !== '/') {
            result.proceduralFilters.push({
                type: 'matches-path',
                label: ':matches-path(dir)',
                filter: pathBase + ':matches-path(/' + pathDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/^\//, '') + '/)',
                description: 'Apply on pages under ' + pathDir
            });
        }
    }

    // :matches-media() - restrict filter to specific viewport/media conditions
    if (result.selectors.length > 0) {
        var mediaBase = result.selectors[0].selector;
        var vw = window.innerWidth;
        if (vw > 0) {
            result.proceduralFilters.push({
                type: 'matches-media',
                label: ':matches-media()',
                filter: mediaBase + ':matches-media((min-width: ' + vw + 'px))',
                description: 'Only apply at viewport width >= ' + vw + 'px'
            });
            if (vw <= 768) {
                result.proceduralFilters.push({
                    type: 'matches-media',
                    label: ':matches-media(mobile)',
                    filter: mediaBase + ':matches-media((max-width: 768px))',
                    description: 'Only apply on mobile viewports (<=768px)'
                });
            }
        }
    }

    // :matches-attr() - match elements by attribute name/value patterns
    var attrKeys = Object.keys(result.attrs);
    if (attrKeys.length > 0) {
        var baseSel = result.tag;
        if (classified.stable.length > 0) {
            baseSel += '.' + escCSS(classified.stable[0]);
        }
        for (var ai = 0; ai < attrKeys.length; ai++) {
            var aKey = attrKeys[ai];
            var aVal = result.attrs[aKey];
            // Skip very long values and common non-distinctive attrs
            if (aKey === 'href' || aKey === 'src' || aKey === 'action') continue;
            if (aVal && aVal.length > 0 && aVal.length < 80) {
                result.proceduralFilters.push({
                    type: 'matches-attr',
                    label: ':matches-attr()',
                    filter: baseSel + ':matches-attr("' + aKey + '"="' + escRegex(aVal) + '")',
                    description: 'Match by ' + aKey + '="' + aVal.substring(0, 30) + (aVal.length > 30 ? '...' : '') + '"'
                });
            } else if (aKey.startsWith('data-')) {
                result.proceduralFilters.push({
                    type: 'matches-attr',
                    label: ':matches-attr(name)',
                    filter: baseSel + ':matches-attr("' + aKey + '")',
                    description: 'Match any element with attribute ' + aKey
                });
            }
        }
    }

    // :matches-css() - match by computed CSS property values
    if (el.offsetWidth > 0 || el.offsetHeight > 0) {
        var cs = getComputedStyle(el);
        var baseSel = result.tag;
        if (classified.stable.length > 0) {
            baseSel += '.' + escCSS(classified.stable[0]);
        } else if (result.id) {
            baseSel = '#' + escCSS(result.id);
        }
        // Only suggest for distinctive visual properties
        if (cs.position === 'fixed' || cs.position === 'sticky') {
            result.proceduralFilters.push({
                type: 'matches-css',
                label: ':matches-css()',
                filter: baseSel + ':matches-css(position: ' + cs.position + ')',
                description: 'Match elements with position: ' + cs.position
            });
        }
        if (cs.zIndex !== 'auto' && parseInt(cs.zIndex, 10) > 999) {
            result.proceduralFilters.push({
                type: 'matches-css',
                label: ':matches-css(z-index)',
                filter: baseSel + ':matches-css(z-index: /^[0-9]{4,}$/)',
                description: 'Match elements with high z-index (overlay/modal pattern)'
            });
        }
    }

    // :matches-css-before() / :matches-css-after() - match by pseudo-element styles
    if (el.offsetWidth > 0 || el.offsetHeight > 0) {
        var baseSel2 = result.tag;
        if (classified.stable.length > 0) {
            baseSel2 += '.' + escCSS(classified.stable[0]);
        } else if (result.id) {
            baseSel2 = '#' + escCSS(result.id);
        }
        ['before', 'after'].forEach(function(pseudo) {
            try {
                var pcs = getComputedStyle(el, '::' + pseudo);
                var content = pcs.getPropertyValue('content');
                if (content && content !== 'none' && content !== 'normal' && content !== '""') {
                    var cleanContent = content.replace(/^["']|["']$/g, '');
                    if (cleanContent.length >= 2 && cleanContent.length <= 60) {
                        result.proceduralFilters.push({
                            type: 'matches-css-' + pseudo,
                            label: ':matches-css-' + pseudo + '()',
                            filter: baseSel2 + ':matches-css-' + pseudo + '(content: /' + escRegex(cleanContent.substring(0, 30)) + '/)',
                            description: '::' + pseudo + ' has content "' + cleanContent.substring(0, 30) + '"'
                        });
                    }
                }
            } catch(e) { /* cross-origin */ }
        });
    }

    // :min-text-length() - filter out empty wrappers
    if (textForFilter && textForFilter.length >= 10) {
        var baseSel = result.tag;
        if (classified.stable.length > 0) {
            baseSel += '.' + escCSS(classified.stable[0]);
        }
        var minLen = Math.max(5, Math.floor(textForFilter.length * 0.3));
        result.proceduralFilters.push({
            type: 'min-text-length',
            label: ':min-text-length()',
            filter: baseSel + ':min-text-length(' + minLen + ')',
            description: 'Only match if text content is at least ' + minLen + ' chars (skips empty wrappers)'
        });
    }

    // :matches-prop() - match by JS property chains (React/SPA frameworks)
    (function generateMatchesProp() {
        var propBaseSel = result.tag;
        if (classified.stable.length > 0) {
            propBaseSel += '.' + escCSS(classified.stable[0]);
        }
        var reactFiberKey = '';
        var reactPropsKey = '';
        var ownKeys;
        try { ownKeys = Object.getOwnPropertyNames(el); } catch(e) { ownKeys = []; }
        for (var pk = 0; pk < ownKeys.length; pk++) {
            if (ownKeys[pk].startsWith('__reactFiber$')) reactFiberKey = ownKeys[pk];
            if (ownKeys[pk].startsWith('__reactProps$')) reactPropsKey = ownKeys[pk];
        }
        if (reactPropsKey) {
            try {
                var rProps = el[reactPropsKey];
                if (rProps && typeof rProps === 'object') {
                    var rpKeys = Object.keys(rProps);
                    for (var rk = 0; rk < rpKeys.length; rk++) {
                        var rpk = rpKeys[rk];
                        if (rpk === 'children' || rpk === 'style' || rpk === 'className' || rpk === 'key' || rpk === 'ref') continue;
                        var rpv = rProps[rpk];
                        if (typeof rpv === 'string' && rpv.length >= 3 && rpv.length <= 60) {
                            result.proceduralFilters.push({
                                type: 'matches-prop',
                                label: ':matches-prop(react)',
                                filter: propBaseSel + ':matches-prop(' + reactPropsKey + '.' + rpk + '="' + escRegex(rpv) + '")',
                                description: 'React prop ' + rpk + '="' + rpv.substring(0, 30) + '"'
                            });
                            break;
                        }
                    }
                }
            } catch(e) { /* cross-origin or frozen */ }
        }
        // Generic own-property scan for non-DOM properties
        for (var gk = 0; gk < ownKeys.length; gk++) {
            var gKey = ownKeys[gk];
            if (gKey.startsWith('__') || gKey === 'style' || gKey === 'className' || gKey === 'id') continue;
            if (gKey.startsWith('on') || gKey === 'innerHTML' || gKey === 'outerHTML' || gKey === 'textContent') continue;
            try {
                var gVal = el[gKey];
                if (typeof gVal === 'string' && gVal.length >= 3 && gVal.length <= 60 && /[a-z]/i.test(gVal)) {
                    result.proceduralFilters.push({
                        type: 'matches-prop',
                        label: ':matches-prop()',
                        filter: propBaseSel + ':matches-prop(' + gKey + '="' + escRegex(gVal) + '")',
                        description: 'JS property ' + gKey + '="' + gVal.substring(0, 30) + '"'
                    });
                    break;
                }
            } catch(e) { /* accessor threw */ }
        }
    })();

    // :remove() - offer as action variant on the best selector
    if (result.selectors.length > 0) {
        var bestSel = result.selectors[0];
        if (bestSel.matches > 0 && bestSel.matches <= 10) {
            result.proceduralFilters.push({
                type: 'remove',
                label: ':remove()',
                filter: bestSel.selector + ':remove()',
                description: 'Remove from DOM instead of hiding (prevents layout shift)'
            });
        }
    }

    // :xpath() - XPath expression for complex structural targeting
    (function generateXpath() {
        var parts = [];
        var cur = el;
        while (cur && cur !== document.documentElement) {
            var tag = cur.tagName.toLowerCase();
            var idx = 1;
            var sib = cur.previousElementSibling;
            while (sib) {
                if (sib.tagName.toLowerCase() === tag) idx++;
                sib = sib.previousElementSibling;
            }
            parts.unshift(tag + '[' + idx + ']');
            cur = cur.parentElement;
        }
        if (parts.length > 0) {
            var xpath = '//html/' + parts.join('/');
            result.proceduralFilters.push({
                type: 'xpath',
                label: ':xpath()',
                filter: ':xpath(' + xpath + ')',
                description: 'Absolute XPath to this element'
            });
        }
        // Shorter XPath when element has unique attributes
        if (result.id) {
            result.proceduralFilters.push({
                type: 'xpath',
                label: ':xpath(id)',
                filter: ':xpath(//' + result.tag + '[@id="' + result.id + '"])',
                description: 'XPath by ID'
            });
        } else if (textForFilter && textForFilter.length >= 5 && textForFilter.length <= 60) {
            result.proceduralFilters.push({
                type: 'xpath',
                label: ':xpath(text)',
                filter: ':xpath(//' + result.tag + '[contains(text(),"' + textForFilter.substring(0, 30).replace(/"/g, '\\\\"') + '")])',
                description: 'XPath by text content'
            });
        }
    })();

    // :watch-attr() - re-evaluate when attributes change (SPA recycling)
    var dynamicAttrs = [];
    if (el.attributes) {
        for (var wi = 0; wi < el.attributes.length; wi++) {
            var wa = el.attributes[wi];
            if (wa.name === 'class' || wa.name === 'style' || wa.name === 'id') continue;
            if (wa.name.startsWith('data-') || wa.name === 'aria-hidden' || wa.name === 'hidden') {
                dynamicAttrs.push(wa.name);
            }
        }
    }
    if (dynamicAttrs.length > 0 && result.selectors.length > 0) {
        var watchBase = result.selectors[0].selector;
        result.proceduralFilters.push({
            type: 'watch-attr',
            label: ':watch-attr()',
            filter: watchBase + ':watch-attr(' + dynamicAttrs.join(',') + ')',
            description: 'Re-evaluate when ' + dynamicAttrs.join(', ') + ' change (for SPAs)'
        });
    }

    // :others() - select everything NOT matching (experimental)
    if (result.selectors.length > 0) {
        var othersSel = result.selectors[0];
        if (othersSel.matches > 0 && othersSel.matches <= 5) {
            result.proceduralFilters.push({
                type: 'others',
                label: ':others()',
                filter: othersSel.selector + ':others()',
                description: 'Hide everything EXCEPT elements matching ' + othersSel.selector
            });
        }
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
}

/******************************************************************************/

export const HIGHLIGHT_SCRIPT = (selector) => `
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

export const REMOVE_HIGHLIGHT_SCRIPT = `
(function() {
    var prev = document.querySelectorAll('.__ubp_highlight__');
    for (var i = 0; i < prev.length; i++) prev[i].remove();
})()
`;

export const PROCEDURAL_HIGHLIGHT_SCRIPT = (proceduralSelector) => {
    const baseAndOp = proceduralSelector.match(/^([^:]*)(:.+)$/);
    if (!baseAndOp) { return 'null'; }
    const baseSel = baseAndOp[1];
    const opChain = baseAndOp[2];
    return `
(function() {
    var prev = document.querySelectorAll('.__ubp_highlight__');
    for (var i = 0; i < prev.length; i++) prev[i].remove();

    var baseSel = ${JSON.stringify(baseSel)};
    var opChain = ${JSON.stringify(opChain)};

    function matchesOp(el, op) {
        var m;
        // :has-text(literal) or :has-text(/regex/flags)
        if ((m = op.match(/^:has-text\\(\\/(.*)\\/([gimsuy]*)\\)$/))) {
            try { return new RegExp(m[1], m[2]).test(el.textContent || ''); } catch(e) { return false; }
        }
        if ((m = op.match(/^:has-text\\((.+)\\)$/))) {
            return (el.textContent || '').indexOf(m[1]) !== -1;
        }
        // :min-text-length(n)
        if ((m = op.match(/^:min-text-length\\((\\d+)\\)$/))) {
            return (el.textContent || '').trim().length >= parseInt(m[1], 10);
        }
        // :matches-attr("name"="value") or :matches-attr("name")
        if ((m = op.match(/^:matches-attr\\("([^"]+)"(?:="([^"]*)")?\\)$/))) {
            if (m[2] !== undefined) {
                try { return new RegExp(m[2]).test(el.getAttribute(m[1]) || ''); } catch(e) { return (el.getAttribute(m[1]) || '') === m[2]; }
            }
            return el.hasAttribute(m[1]);
        }
        // :matches-css(prop: value)
        if ((m = op.match(/^:matches-css\\(([^:]+):\\s*(.+)\\)$/))) {
            var cv = getComputedStyle(el).getPropertyValue(m[1].trim());
            var pat = m[2].trim();
            if (pat.startsWith('/') && pat.lastIndexOf('/') > 0) {
                var ri = pat.lastIndexOf('/');
                try { return new RegExp(pat.substring(1, ri), pat.substring(ri + 1)).test(cv); } catch(e) { return false; }
            }
            return cv.trim() === pat;
        }
        // :upward(N)
        if ((m = op.match(/^:upward\\((\\d+)\\)$/))) {
            var n = parseInt(m[1], 10);
            var cur = el;
            for (var i = 0; i < n && cur; i++) cur = cur.parentElement;
            return cur || null;
        }
        // :upward(selector)
        if ((m = op.match(/^:upward\\((.+)\\)$/))) {
            return el.closest(m[1]);
        }
        // :matches-path(pattern)
        if ((m = op.match(/^:matches-path\\((.+)\\)$/))) {
            var pat = m[1];
            if (pat.startsWith('/') && pat.lastIndexOf('/') > 0) {
                var ri = pat.lastIndexOf('/');
                try { return new RegExp(pat.substring(1, ri), pat.substring(ri + 1)).test(location.pathname + location.search); } catch(e) { return false; }
            }
            return (location.pathname + location.search).indexOf(pat) !== -1;
        }
        // :not(:has-text(...))
        if ((m = op.match(/^:not\\((:has-text\\(.+\\))\\)$/))) {
            return !matchesOp(el, m[1]);
        }
        return false;
    }

    // Parse operator chain (simplified: split on top-level colons)
    var ops = [];
    var remaining = opChain;
    while (remaining.length > 0) {
        var colon = remaining.indexOf(':');
        if (colon === -1) break;
        var depth = 0; var end = colon + 1;
        for (; end < remaining.length; end++) {
            if (remaining[end] === '(') depth++;
            else if (remaining[end] === ')') { depth--; if (depth === 0) { end++; break; } }
        }
        ops.push(remaining.substring(colon, end));
        remaining = remaining.substring(end);
    }

    // Skip :remove() — not previewable
    ops = ops.filter(function(o) { return o !== ':remove()'; });
    // :matches-path is a page-level filter, evaluate first
    var pathOp = ops.filter(function(o) { return o.startsWith(':matches-path'); });
    if (pathOp.length > 0 && !matchesOp(document.body, pathOp[0])) {
        return JSON.stringify({ count: 0, note: 'Path does not match current page' });
    }
    ops = ops.filter(function(o) { return !o.startsWith(':matches-path'); });

    var candidates;
    try { candidates = baseSel ? Array.from(document.querySelectorAll(baseSel)) : [document.documentElement]; }
    catch(e) { return JSON.stringify({ count: -1, note: 'Invalid base selector' }); }

    var matched = [];
    for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        var pass = true;
        var target = el;
        for (var j = 0; j < ops.length; j++) {
            var r = matchesOp(target, ops[j]);
            if (r === false || r === null || r === undefined) { pass = false; break; }
            if (r instanceof HTMLElement || r instanceof Element) { target = r; }
        }
        if (pass) matched.push(target);
    }

    // Highlight matched elements
    for (var i = 0; i < matched.length; i++) {
        var rect = matched[i].getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        var overlay = document.createElement('div');
        overlay.className = '__ubp_highlight__';
        overlay.style.cssText = 'position:fixed !important;top:' + rect.top + 'px !important;left:' + rect.left + 'px !important;width:' + rect.width + 'px !important;height:' + rect.height + 'px !important;background:rgba(203,166,247,0.25) !important;border:2px solid rgba(203,166,247,0.8) !important;pointer-events:none !important;z-index:2147483647 !important;box-sizing:border-box !important;transition:opacity 150ms ease !important;';
        document.documentElement.appendChild(overlay);
    }
    return JSON.stringify({ count: matched.length });
})()`;
};

export const HIDE_ELEMENT_SCRIPT = (selector) => `
(function() {
    try {
        var els = document.querySelectorAll(${JSON.stringify(selector)});
        for (var i = 0; i < els.length; i++) {
            if (CSS.supports && CSS.supports('content-visibility', 'hidden')) {
                els[i].style.setProperty('content-visibility', 'hidden', 'important');
                els[i].style.setProperty('max-height', '0', 'important');
                els[i].style.setProperty('overflow', 'hidden', 'important');
            } else {
                els[i].style.setProperty('display', 'none', 'important');
            }
        }
        return els.length;
    } catch(e) {
        return -1;
    }
})()
`;

export const SCAN_SHADOW_SCRIPT = `
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

export const SCAN_IFRAMES_SCRIPT = `
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
export const PICK_ELEMENT_SCRIPT = `
(function() {
    if (window.__ubp_picker_active__) return 'already_active';

    window.__ubp_picker_active__ = true;

    // Freeze page state: intercept timers so dynamic elements stay visible
    var frozenTimers = [];
    var origSetTimeout = window.setTimeout;
    var origSetInterval = window.setInterval;
    var origRAF = window.requestAnimationFrame;
    window.setTimeout = function(fn, ms) {
        if (ms === undefined || ms > 50) { frozenTimers.push({ type: 'timeout', fn: fn, ms: ms }); return -1; }
        return origSetTimeout.call(window, fn, ms);
    };
    window.setInterval = function(fn, ms) {
        frozenTimers.push({ type: 'interval', fn: fn, ms: ms }); return -1;
    };
    window.requestAnimationFrame = function(fn) {
        frozenTimers.push({ type: 'raf', fn: fn }); return -1;
    };

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
        // Unfreeze: restore timer APIs
        window.setTimeout = origSetTimeout;
        window.setInterval = origSetInterval;
        window.requestAnimationFrame = origRAF;
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

export const YT_SWEEP_SCRIPT = `
(function() {
    if (!location.hostname.includes('youtube.com')) {
        return JSON.stringify({ error: 'Not on YouTube' });
    }
    var selectors = [
        { name: 'Masthead ad', sel: 'ytd-rich-item-renderer[is-ad]' },
        { name: 'In-feed ad', sel: 'ytd-ad-slot-renderer' },
        { name: 'Video ad overlay', sel: '.ytp-ad-overlay-container' },
        { name: 'Skip button', sel: '.ytp-ad-skip-button-container' },
        { name: 'Ad text overlay', sel: '.ytp-ad-text-overlay' },
        { name: 'Player ad', sel: '.ytp-ad-player-overlay' },
        { name: 'Companion ad banner', sel: '#companion .ytd-companion-slot-renderer' },
        { name: 'Promoted video', sel: 'ytd-promoted-sparkles-web-renderer' },
        { name: 'Promoted item', sel: 'ytd-display-ad-renderer' },
        { name: 'Action companion', sel: 'ytd-action-companion-ad-renderer' },
        { name: 'In-feed sponsored', sel: 'ytd-in-feed-ad-layout-renderer' },
        { name: 'Merch shelf', sel: 'ytd-merch-shelf-renderer' },
        { name: 'Movie offer', sel: 'ytd-movie-offer-module-renderer' },
        { name: 'Donation prompt', sel: 'ytd-donation-shelf-renderer' },
        { name: 'Live chat banner', sel: 'yt-live-chat-banner-renderer' },
        { name: 'Live chat ticker', sel: 'yt-live-chat-ticker-renderer' },
        { name: 'Paid sticker', sel: 'yt-live-chat-paid-sticker-renderer' },
        { name: 'Super chat', sel: 'yt-live-chat-paid-message-renderer' },
        { name: 'Membership item', sel: 'yt-live-chat-membership-item-renderer' },
        { name: 'Shorts shelf', sel: 'ytd-reel-shelf-renderer' },
        { name: 'Shorts entry', sel: 'ytd-rich-shelf-renderer[is-shorts]' },
        { name: 'Survey', sel: 'ytd-survey-renderer' },
        { name: 'Brand watermark', sel: '.ytp-watermark' },
        { name: 'Engagement panel ad', sel: 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]' },
        { name: 'Statement banner', sel: 'ytd-statement-banner-renderer' },
        { name: 'Clarification renderer', sel: 'ytd-clarification-renderer' },
        { name: 'Player ad module', sel: '.ytp-ad-module' },
    ];
    var results = [];
    for (var i = 0; i < selectors.length; i++) {
        var s = selectors[i];
        try {
            var els = document.querySelectorAll(s.sel);
            var visible = 0;
            for (var j = 0; j < els.length; j++) {
                if (els[j].offsetParent !== null || els[j].offsetWidth > 0) visible++;
            }
            results.push({
                name: s.name,
                selector: s.sel,
                total: els.length,
                visible: visible
            });
        } catch(e) {
            results.push({ name: s.name, selector: s.sel, total: 0, visible: 0 });
        }
    }
    return JSON.stringify(results);
})()
`;
