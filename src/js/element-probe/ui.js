/*******************************************************************************

    Element Probe presentation and filter-selection helpers.

*/

import {
    $, formatSelectionLabel, getCurrentFrameLabel, setSelectionSummary,
    setText, state, truncate,
} from './state.js';
import {
    HIGHLIGHT_SCRIPT,
    REMOVE_HIGHLIGHT_SCRIPT,
} from './page-scripts.js';

const PROCEDURAL_RE = /:has-text|:upward|:xpath\(|:matches-path|:matches-attr|:matches-css|:matches-media|:matches-prop|:min-text-length|:remove\(\)|:style\(|:watch-attr|:others\(\)|:not\(:has-text\(/i;
let matchCountTimer;

function updateWorkflowSummary() {
    const frameCount = Math.max(($('frameTarget')?.options.length || 1) - 1, 0);
    const output = $('filterOutput')?.value || '';
    const hasFilterValue = output.trim() !== '';
    const isProcedural = PROCEDURAL_RE.test(output);
    setText('overviewTargetValue', state.currentFrameUrl ? 'Focused iframe' : 'Top document');
    setText(
        'overviewTargetHint',
        state.currentFrameUrl
            ? truncate(getCurrentFrameLabel(), 84)
            : frameCount === 0
                ? 'Inspecting the main page context.'
                : `${frameCount} iframe target${frameCount === 1 ? '' : 's'} detected on this page.`
    );
    if ( state.lastInspectedData ) {
        setText('overviewSelectionValue', formatSelectionLabel(state.lastInspectedData));
        setText(
            'overviewSelectionHint',
            state.lastInspectedData.inShadowDOM
                ? `Inside shadow DOM${state.lastInspectedData.shadowHost ? ` via ${state.lastInspectedData.shadowHost}` : ''}.`
                : truncate(state.lastInspectedData.textContent || `On ${state.lastInspectedData.hostname || 'the current page'}`, 84)
        );
    } else {
        setText('overviewSelectionValue', 'Waiting for a node');
        setText('overviewSelectionHint', 'Select in Elements or use Pick on page.');
    }
    if ( !state.lastInspectedData ) {
        setText('overviewOutputValue', 'No output yet');
        setText('overviewOutputHint', 'Inspect an element to generate selectors and cosmetic rules.');
        return;
    }
    const proceduralCount = Array.isArray(state.lastInspectedData.proceduralFilters)
        ? state.lastInspectedData.proceduralFilters.length
        : 0;
    if ( hasFilterValue ) {
        setText('overviewOutputValue', isProcedural ? 'Procedural rule ready' : state.isHighlighting ? 'Previewing rule' : 'Rule ready');
        setText('overviewOutputHint', isProcedural
            ? 'Save it to your filters, then reload the page to validate the result.'
            : state.isHighlighting
                ? 'A live highlight is active on the inspected page for the current selector.'
                : 'Preview, copy, or save the current selector as a cosmetic filter.');
        return;
    }
    setText('overviewOutputValue', `${state.currentSelectors.length} selector${state.currentSelectors.length === 1 ? '' : 's'} ready`);
    setText('overviewOutputHint', proceduralCount === 0
        ? 'Pick the most stable selector to continue.'
        : `${proceduralCount} procedural filter${proceduralCount === 1 ? '' : 's'} also generated for harder targets.`);
}

function updateFilterHint() {
    const section = $('filterSection');
    const output = $('filterOutput');
    if ( !section || !output ) { return; }
    const value = output.value.trim();
    const hasValue = value !== '';
    let badge = 'Selection required';
    let text = 'Choose a selector or procedural filter to build a rule.';
    let mode = 'idle';
    if ( state.lastInspectedData && !hasValue ) {
        badge = 'Choose a selector';
        text = state.currentSelectors.length === 0
            ? 'No stable selectors were generated for this node yet. Try scanning shadow DOM or picking a different ancestor.'
            : `${state.currentSelectors.length} selector suggestion${state.currentSelectors.length === 1 ? '' : 's'} ready. Pick the most stable option before saving.`;
        mode = 'ready';
    } else if ( hasValue && PROCEDURAL_RE.test(value) ) {
        badge = 'Procedural rule';
        text = 'Procedural rule — click Preview to highlight matching elements, or Apply to save to your filters.';
        mode = 'procedural';
    } else if ( hasValue && state.isHighlighting ) {
        badge = 'Preview active';
        text = 'The current selector is highlighted in the inspected page. Save it if the match looks right, or clear the preview.';
        mode = 'preview';
    } else if ( hasValue ) {
        badge = 'Rule ready';
        text = 'CSS selectors can be previewed before saving, copied for review, or sent straight to your user filters.';
        mode = 'ready';
    }
    section.dataset.mode = mode;
    setText('filterHintBadge', badge);
    setText('filterHintText', text);
}

function updateMatchCount(filterValue, isProcedural) {
    if ( matchCountTimer !== undefined ) { clearTimeout(matchCountTimer); }
    const badge = $('filterMatchCount');
    if ( !badge ) { return; }
    if ( !filterValue ) {
        badge.textContent = '';
        badge.removeAttribute('data-state');
        return;
    }
    matchCountTimer = setTimeout(async () => {
        if ( state.panelClosed ) { return; }
        const match = filterValue.match(/(?:##|#@#)(.+)$/);
        if ( !match ) { badge.textContent = ''; return; }
        let count = null;
        if ( !isProcedural ) {
            const code = `(function(){try{return document.querySelectorAll(${JSON.stringify(match[1])}).length}catch(e){return -1}})()`;
            try { count = await state.evalInPage(code); } catch { count = -1; }
        }
        if ( state.panelClosed ) { return; }
        badge.removeAttribute('data-state');
        if ( count === null ) {
            badge.textContent = 'procedural';
        } else if ( count === -1 ) {
            badge.textContent = 'invalid';
            badge.dataset.state = 'error';
        } else if ( count === 0 ) {
            badge.textContent = '0 matches';
            badge.dataset.state = 'zero';
        } else {
            badge.textContent = count + ' match' + (count === 1 ? '' : 'es');
            badge.dataset.state = 'match';
        }
    }, 250);
}

function updateCompatBadge(value) {
    const badge = $('filterCompatBadge');
    if ( !badge ) { return; }
    const uboOnly = [ ':matches-path', ':matches-media', ':watch-attr', ':others()' ];
    const shared = [ ':has-text', ':upward', ':matches-attr', ':matches-css', ':remove()', ':min-text-length', ':not(:has-text' ];
    const found = [];
    for ( const op of uboOnly ) { if ( value.includes(op) ) { found.push(`${op} → uBO only`); } }
    for ( const op of shared ) { if ( value.includes(op) ) { found.push(`${op} → uBO, AdGuard, Brave`); } }
    badge.textContent = found.some(text => text.endsWith('uBO only')) ? 'uBO only' : found.length ? 'uBO+AG+Brave' : '';
    badge.title = found.join('\n');
    badge.dataset.level = found.some(text => text.endsWith('uBO only')) ? 'narrow' : 'wide';
}

function syncFilterActions() {
    const value = $('filterOutput')?.value.trim() || '';
    const procedural = PROCEDURAL_RE.test(value);
    $('btnApplyFilter').disabled = !value;
    $('btnCopyFilter').disabled = !value;
    $('btnTestFilter').disabled = !value || (procedural && /:remove\(\)/.test(value));
    $('btnRemoveFilter').disabled = !state.isHighlighting;
    updateFilterHint();
    updateWorkflowSummary();
    updateMatchCount(value, procedural);
    updateCompatBadge(value);
}

function setHighlighting(value) {
    state.isHighlighting = value;
    syncFilterActions();
}

function displayElementInfo(data) {
    setText('elTag', '<' + (data.tag || '?') + '>');
    setText('elId', data.id || '(none)');
    setText('elClasses', data.classes.length ? data.classes.join(' ') : '(none)');
    const keys = Object.keys(data.attrs);
    setText('elAttrs', keys.length ? keys.map(k => `${k}="${data.attrs[k]}"`).join(', ') : '(none)');
    setText('elDims', data.rect ? `${data.rect.w} x ${data.rect.h} px` : '--');
    setText('elVisibility', data.visibility || '--');
    setText('elPosition', data.position || '--');
    setText('elComputed', data.computed || '--');
    setText('elText', data.textContent ? data.textContent.substring(0, 100) + (data.textContent.length > 100 ? '...' : '') : '(none)');
    const summary = [ data.tag || '?' ];
    if ( data.id ) { summary.push('#' + data.id); }
    if ( data.classes.length ) { summary.push('.' + data.classes[0]); }
    setSelectionSummary(`${summary.join('')} on ${data.hostname || 'the current page'}`);
    const badge = $('shadowBadge');
    if ( !badge ) { return; }
    badge.style.display = data.inShadowDOM ? '' : 'none';
    if ( data.inShadowDOM ) {
        badge.textContent = data.shadowClosed ? 'Closed Shadow DOM' : 'Shadow DOM';
        badge.title = 'Host: ' + (data.shadowHost || 'unknown');
    }
}

function displaySelectors(selectors) {
    state.currentSelectors = selectors;
    state.selectedSelectorIndex = -1;
    const container = $('selectorList');
    if ( !container ) { return; }
    while ( container.lastChild ) { container.lastChild.remove(); }
    setText('selectorCount', `${selectors.length} selector${selectors.length === 1 ? '' : 's'}`);
    selectors.forEach((sel, index) => {
        const item = document.createElement('div');
        item.className = 'selector-item';
        const badge = document.createElement('span');
        badge.className = 'selector-type ' + sel.type;
        badge.textContent = sel.label;
        const text = document.createElement('span');
        text.className = 'selector-text';
        text.textContent = sel.selector;
        const count = document.createElement('span');
        count.className = 'match-count';
        count.textContent = sel.matches === -1 ? '?' : `${sel.matches} match${sel.matches === 1 ? '' : 'es'}`;
        item.append(badge, text, count);
        item.addEventListener('click', () => selectSelector(index));
        item.addEventListener('mouseenter', () => {
            if ( $('chkLivePreview')?.checked && sel.matches !== -1 ) { state.evalInPage(HIGHLIGHT_SCRIPT(sel.selector)); }
        });
        item.addEventListener('mouseleave', () => { if ( !state.isHighlighting ) { state.evalInPage(REMOVE_HIGHLIGHT_SCRIPT); } });
        container.appendChild(item);
    });
    if ( selectors.length ) { selectSelector(0); } else { updateWorkflowSummary(); }
}

function displayProceduralFilters(filters) {
    const container = $('proceduralList');
    if ( !container ) { return; }
    while ( container.lastChild ) { container.lastChild.remove(); }
    setText('proceduralCount', `${filters.length} filter${filters.length === 1 ? '' : 's'}`);
    if ( !filters.length ) { $('proceduralSection').style.display = 'none'; return; }
    filters.forEach(pf => {
        const item = document.createElement('div');
        item.className = 'selector-item procedural-item';
        const badge = document.createElement('span');
        badge.className = 'selector-type procedural';
        badge.textContent = pf.label;
        const content = document.createElement('div');
        content.className = 'procedural-content';
        const value = document.createElement('span');
        value.className = 'selector-text';
        value.textContent = pf.filter;
        const desc = document.createElement('span');
        desc.className = 'procedural-desc';
        desc.textContent = pf.description;
        content.append(value, desc);
        item.append(badge, content);
        item.addEventListener('click', () => {
            $('filterOutput').value = (state.currentHostname || '*') + '##' + pf.filter;
            state.evalInPage(REMOVE_HIGHLIGHT_SCRIPT);
            setHighlighting(false);
            document.querySelectorAll('.selector-item').forEach(node => node.classList.remove('selected'));
            item.classList.add('selected');
            state.selectedSelectorIndex = -1;
            syncFilterActions();
        });
        container.appendChild(item);
    });
    updateWorkflowSummary();
}

function selectSelector(index) {
    state.selectedSelectorIndex = index;
    const sel = state.currentSelectors[index];
    if ( !sel ) { return; }
    $('selectorList')?.querySelectorAll('.selector-item').forEach((node, i) => node.classList.toggle('selected', i === index));
    $('proceduralList')?.querySelectorAll('.selector-item').forEach(node => node.classList.remove('selected'));
    $('filterOutput').value = generateFilter(sel);
    if ( sel.matches !== -1 ) {
        state.evalInPage(HIGHLIGHT_SCRIPT(sel.selector));
        state.isHighlighting = true;
    }
    syncFilterActions();
}

function generateFilter(sel) {
    const hostname = $('filterDomains')?.value.trim() || state.currentHostname || '*';
    const type = $('filterType')?.value || '##';
    if ( type === '##-remove' ) { return hostname + '##' + sel.selector + ':remove()'; }
    if ( type === '##-style' ) {
        const style = $('styleValue')?.value.trim() || 'opacity: 0 !important';
        return hostname + '##' + sel.selector + ':style(' + style + ')';
    }
    return hostname + type + sel.selector;
}

function initializeUI() {
    state.updateWorkflowSummary = updateWorkflowSummary;
    state.syncFilterActions = syncFilterActions;
}

export {
    PROCEDURAL_RE, displayElementInfo, displayProceduralFilters,
    displaySelectors, generateFilter, initializeUI, selectSelector,
    setHighlighting, syncFilterActions, updateWorkflowSummary,
};
