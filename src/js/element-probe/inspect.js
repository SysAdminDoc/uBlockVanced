/*******************************************************************************

    Element Probe inspected-page evaluation and selection inspection.

*/

import {
    $, log, setBusy, setSelectionSummary, setStatus, state,
} from './state.js';
import {
    displayElementInfo, displayProceduralFilters, displaySelectors,
} from './ui.js';
import { buildInspectScript } from './page-scripts.js';

function evalInPage(code, frameUrl) {
    const targetFrame = frameUrl !== undefined ? frameUrl : state.currentFrameUrl;
    const options = targetFrame ? { frameURL: targetFrame } : undefined;
    return new Promise((resolve, reject) => {
        chrome.devtools.inspectedWindow.eval(code, options, (result, error) => {
            if ( error ) { reject(error); } else { resolve(result); }
        });
    });
}

async function inspectSelected() {
    setStatus('Inspecting...', 'active');
    setBusy('btnInspectSelected', true, 'Inspecting...');
    log('Inspecting selected element...', 'info');
    try {
        const raw = await evalInPage(buildInspectScript(state.activeClassPatterns));
        if ( state.panelClosed ) { return; }
        let data;
        try { data = JSON.parse(raw); } catch {
            log('Inspector payload was not valid JSON (page may have navigated mid-scan)', 'error');
            setStatus('Error', 'error');
            return;
        }
        if ( !data || typeof data !== 'object' ) {
            log('Inspector returned no data', 'error');
            setStatus('Error', 'error');
            return;
        }
        if ( data.error ) {
            log(data.error, 'error');
            setStatus('Error', 'error');
            return;
        }
        data.selectors = Array.isArray(data.selectors) ? data.selectors : [];
        data.proceduralFilters = Array.isArray(data.proceduralFilters) ? data.proceduralFilters : [];
        if ( !Array.isArray(data.classes) ) { data.classes = []; }
        if ( !data.attrs || typeof data.attrs !== 'object' ) { data.attrs = {}; }
        state.lastInspectedData = data;
        state.currentHostname = (data.hostname || '').replace(/^www\./, '');
        state.currentPageUrl = data.pageUrl || '';
        const domainInput = $('filterDomains');
        if ( domainInput && (!domainInput.value || domainInput.dataset.auto !== 'false') ) {
            domainInput.value = state.currentHostname;
            domainInput.dataset.auto = 'true';
        }
        displayElementInfo(data);
        displaySelectors(data.selectors);
        displayProceduralFilters(data.proceduralFilters);
        const hide = id => { const node = $(id); if ( node ) { node.style.display = 'none'; } };
        const show = id => { const node = $(id); if ( node ) { node.style.display = ''; } };
        hide('emptyState');
        show('elementSection');
        show('selectorSection');
        if ( data.proceduralFilters.length ) { show('proceduralSection'); }
        show('filterSection');
        setStatus('Element inspected', 'active');
        log(`Inspected <${data.tag}> - ${data.selectors.length} selectors, ${data.proceduralFilters.length} procedural filters`, 'success');
    } catch ( error ) {
        if ( state.panelClosed ) { return; }
        log('Inspection failed: ' + (error.message || String(error)), 'error');
        setStatus('Error', 'error');
    } finally {
        setBusy('btnInspectSelected', false);
    }
}

function resetInspectionState() {
    state.lastInspectedData = null;
    state.currentSelectors = [];
    state.selectedSelectorIndex = -1;
    state.currentFrameUrl = '';
    state.isHighlighting = false;
    const hide = id => { const node = $(id); if ( node ) { node.style.display = 'none'; } };
    const show = id => { const node = $(id); if ( node ) { node.style.display = ''; } };
    show('emptyState');
    hide('elementSection');
    hide('selectorSection');
    hide('proceduralSection');
    hide('filterSection');
    if ( $('filterOutput') ) { $('filterOutput').value = ''; }
    const select = $('frameTarget');
    if ( select ) {
        while ( select.options.length > 1 ) { select.remove(1); }
        select.value = '';
    }
    setSelectionSummary('No element selected yet.');
}

state.evalInPage = evalInPage;

export { evalInPage, inspectSelected, resetInspectionState };
