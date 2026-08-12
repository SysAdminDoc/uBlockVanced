/*******************************************************************************

    uBlockVanced - Element Probe DevTools panel entry point.

    The panel is intentionally assembled from small feature modules. Keep
    orchestration here; inspection, UI, history, picker actions, and frame
    targeting live under ./element-probe/.

*/

import {
    $, i18n, log, renderI18n, setSelectionSummary, setStatus, state,
    syncLogState,
} from './element-probe/state.js';
import { detectYouTube, scanFrames, setupFrames } from './element-probe/frames.js';
import {
    generateFilter, initializeUI, syncFilterActions,
} from './element-probe/ui.js';
import { loadHistory, setupHistoryHandlers } from './element-probe/history.js';
import { DEFAULT_CLASS_PATTERNS } from './element-probe/page-scripts.js';
import { inspectSelected } from './element-probe/inspect.js';
import { setupPickerHandlers } from './element-probe/picker.js';

renderI18n();
initializeUI();

// Load the optional class-name heuristics before the first inspection.
chrome.storage.local.get('probeClassPatterns', result => {
    if ( Array.isArray(result.probeClassPatterns) ) {
        state.activeClassPatterns = result.probeClassPatterns;
    } else {
        state.activeClassPatterns = DEFAULT_CLASS_PATTERNS;
    }
});

function setupEditorHandlers() {
    $('filterOutput')?.addEventListener('input', syncFilterActions);
    $('filterType')?.addEventListener('change', () => {
        const styleRow = $('styleInputRow');
        if ( styleRow ) { styleRow.style.display = $('filterType').value === '##-style' ? 'flex' : 'none'; }
        if ( state.selectedSelectorIndex >= 0 && state.currentSelectors[state.selectedSelectorIndex] ) {
            $('filterOutput').value = generateFilter(state.currentSelectors[state.selectedSelectorIndex]);
        }
        syncFilterActions();
    });
    $('styleValue')?.addEventListener('input', () => {
        if ( $('filterType').value === '##-style' && state.selectedSelectorIndex >= 0 && state.currentSelectors[state.selectedSelectorIndex] ) {
            $('filterOutput').value = generateFilter(state.currentSelectors[state.selectedSelectorIndex]);
        }
    });
    $('filterDomains')?.addEventListener('input', () => {
        $('filterDomains').dataset.auto = 'false';
        if ( state.selectedSelectorIndex >= 0 && state.currentSelectors[state.selectedSelectorIndex] ) {
            $('filterOutput').value = generateFilter(state.currentSelectors[state.selectedSelectorIndex]);
        }
    });
    $('btnInspectSelected')?.addEventListener('click', inspectSelected);
    $('btnClearLog')?.addEventListener('click', () => {
        const node = $('log');
        if ( node ) { node.replaceChildren(); }
        log('Activity log cleared', 'info');
    });
}

setupEditorHandlers();
setupHistoryHandlers();
setupPickerHandlers();
setupFrames();
loadHistory();
scanFrames();
detectYouTube();
syncLogState();
log('Element Probe v0.3.1 initialized', 'info');
setStatus(i18n('epStatusReady') || 'Ready');
setSelectionSummary(i18n('epNoElementSelected') || 'No element selected yet.');
syncFilterActions();
