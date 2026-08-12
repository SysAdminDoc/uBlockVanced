/*******************************************************************************

    Element Probe picker, preview, and filter-action handlers.

*/

import { $, log, setBusy, setStatus, state } from './state.js';
import {
    HIDE_ELEMENT_SCRIPT,
    HIGHLIGHT_SCRIPT,
    PICK_ELEMENT_SCRIPT,
    PROCEDURAL_HIGHLIGHT_SCRIPT,
    REMOVE_HIGHLIGHT_SCRIPT,
    SCAN_SHADOW_SCRIPT,
    YT_SWEEP_SCRIPT,
} from './page-scripts.js';
import { PROCEDURAL_RE, setHighlighting } from './ui.js';
import {
    addToHistory, checkFilterCollision, persistFilter, unhideOnPage,
} from './history.js';
import { evalInPage } from './inspect.js';

const isValidCssSelector = selector => {
    try {
        document.createDocumentFragment().querySelector(selector);
        return true;
    } catch { return false; }
};

async function inspectPoint() {
    setStatus('Pick mode active', 'active');
    setBusy('btnInspectPoint', true, 'Pick mode active');
    log(state.currentFrameUrl
        ? 'Hover over an element inside the iframe and click to select. Press Escape to cancel.'
        : 'Hover over an element and click to select. Press Escape to cancel.', 'info');
    try {
        const result = await evalInPage(PICK_ELEMENT_SCRIPT);
        if ( result === 'already_active' ) { log('Picker already active on page', 'info'); return; }
        log('Picker injected. Click an element on the page.', 'info');
    } catch ( error ) {
        log('Failed to enter pick mode: ' + (error.message || error), 'error');
        setStatus('Error', 'error');
    } finally { setBusy('btnInspectPoint', false); }
}

async function scanShadow() {
    setStatus('Scanning shadow DOM...', 'active');
    setBusy('btnScanShadow', true, 'Scanning...');
    log('Scanning for shadow DOM hosts...', 'info');
    try {
        const hosts = JSON.parse(await evalInPage(SCAN_SHADOW_SCRIPT));
        if ( hosts.length === 0 ) { log('No shadow DOM hosts found on this page', 'info'); }
        else {
            log(`Found ${hosts.length} shadow DOM host(s):`, 'success');
            hosts.forEach(host => log(`  ${host.host} (${host.childCount} children)`, 'info'));
        }
        setStatus('Scan complete', 'active');
    } catch ( error ) {
        log('Shadow scan failed: ' + error, 'error');
        setStatus('Error', 'error');
    } finally { setBusy('btnScanShadow', false); }
}

async function youtubeSweep() {
    setBusy('btnYtSweep', true, 'Sweeping...');
    log('Running YouTube ad container sweep...', 'info');
    try {
        const results = JSON.parse(await evalInPage(YT_SWEEP_SCRIPT));
        if ( results.error ) { log(results.error, 'error'); return; }
        const found = results.filter(result => result.total > 0);
        if ( found.length === 0 ) { log('No known ad containers detected on this page', 'success'); }
        else {
            log(`Found ${found.length} ad container type(s):`, 'info');
            found.forEach(result => log(`  ${result.name}: ${result.total} element(s) — ${result.selector}`, result.visible > 0 ? 'error' : 'info'));
        }
        log(`${results.filter(result => result.total === 0).length}/${results.length} container types clean`, 'success');
    } catch ( error ) { log('Sweep failed: ' + (error.message || error), 'error'); }
    finally { setBusy('btnYtSweep', false); }
}

async function applyFilter() {
    const filter = $('filterOutput')?.value.trim();
    if ( !filter ) { return; }
    setBusy('btnApplyFilter', true, 'Saving...');
    const match = filter.match(/(?:##|#@#)(.+)$/);
    if ( !match ) { log('Invalid filter format — expected "domain##selector"', 'error'); setBusy('btnApplyFilter', false); return; }
    const selector = match[1];
    const procedural = PROCEDURAL_RE.test(selector);
    if ( !procedural && !isValidCssSelector(selector) ) {
        log('Invalid CSS selector — not saved. Fix the syntax and try again.', 'error');
        setBusy('btnApplyFilter', false);
        return;
    }
    const collisions = await checkFilterCollision(filter);
    if ( collisions ) {
        for ( const collision of collisions ) {
            if ( collision.type === 'duplicate' ) {
                log('Duplicate: this filter already exists in your list', 'error');
                setBusy('btnApplyFilter', false);
                return;
            }
            log(`Warning: ${collision.type} rule — ${collision.rule}`, 'info');
        }
    }
    if ( procedural ) {
        log('Procedural filter detected. Persisting to uBlock...', 'info');
        if ( await persistFilter(filter) ) {
            addToHistory(filter, selector, state.currentHostname);
            log('Procedural filter saved. Reload the page for it to take effect.', 'success');
        }
        setBusy('btnApplyFilter', false);
        return;
    }
    try {
        const count = await evalInPage(HIDE_ELEMENT_SCRIPT(selector));
        if ( state.panelClosed ) { return; }
        if ( count > 0 ) {
            log(`Applied filter: hid ${count} element(s)`, 'success');
            if ( await persistFilter(filter) ) { addToHistory(filter, selector, state.currentHostname); }
        } else if ( count === 0 ) { log('No elements matched the selector', 'error'); }
        else { log('Invalid selector', 'error'); }
    } catch ( error ) { log('Failed to apply: ' + (error.message || error), 'error'); }
    finally { setBusy('btnApplyFilter', false); }
}

function copyFilter() {
    const filter = $('filterOutput')?.value.trim();
    if ( !filter ) { return; }
    navigator.clipboard.writeText(filter).then(() => {
        log('Filter copied to clipboard', 'success');
        const button = $('btnCopyFilter');
        button.textContent = 'Copied!';
        setTimeout(() => { button.textContent = 'Copy'; }, 1500);
    }).catch(() => {
        log('Could not copy -- select the filter text and copy manually', 'info');
        $('filterOutput').select();
    });
}

async function testFilter() {
    const filter = $('filterOutput')?.value.trim();
    if ( !filter ) { return; }
    setBusy('btnTestFilter', true, 'Previewing...');
    const match = filter.match(/(?:##|#@#)(.+)$/);
    if ( !match ) { log('Invalid filter format', 'error'); setBusy('btnTestFilter', false); return; }
    const selector = match[1];
    if ( PROCEDURAL_RE.test(selector) ) {
        if ( /:remove\(\)/.test(selector) ) {
            log(':remove() cannot be previewed (irreversible). Apply to test.', 'info');
            setBusy('btnTestFilter', false);
            return;
        }
        try {
            const result = JSON.parse(await evalInPage(PROCEDURAL_HIGHLIGHT_SCRIPT(selector)) || '{}');
            if ( result.count > 0 ) { setHighlighting(true); log(`Preview: ${result.count} element(s) match procedural filter`, 'info'); }
            else { log(result.note || 'No elements match this procedural filter on the current page', result.count < 0 ? 'error' : 'info'); }
        } catch ( error ) { log('Procedural preview failed: ' + (error.message || error), 'error'); }
        finally { setBusy('btnTestFilter', false); }
        return;
    }
    try { await evalInPage(HIGHLIGHT_SCRIPT(selector)); setHighlighting(true); log(`Preview: highlighting elements matching "${selector}"`, 'info'); }
    catch ( error ) { log('Preview failed: ' + error, 'error'); }
    finally { setBusy('btnTestFilter', false); }
}

async function removePreview() {
    try { await evalInPage(REMOVE_HIGHLIGHT_SCRIPT); setHighlighting(false); log('Preview removed', 'info'); }
    catch ( error ) { log('Failed to remove preview: ' + error, 'error'); }
}

async function testApply() {
    const filter = $('filterOutput')?.value.trim();
    const match = filter?.match(/(?:##|#@#)(.+)$/);
    if ( !match ) { log('Invalid filter format', 'error'); return; }
    if ( PROCEDURAL_RE.test(match[1]) ) { log('Temporary apply only works with standard CSS selectors.', 'info'); return; }
    setBusy('btnTestApply', true, 'Testing...');
    try {
        const count = await evalInPage(HIDE_ELEMENT_SCRIPT(match[1]));
        if ( state.panelClosed ) { return; }
        if ( count > 0 ) {
            log(`Test: hid ${count} element(s) — reverting in 5 seconds`, 'info');
            setTimeout(async () => { if ( !state.panelClosed ) { await unhideOnPage(match[1]); log('Test reverted', 'info'); } }, 5000);
        } else { log('No elements matched for test', 'info'); }
    } catch ( error ) { log('Test failed: ' + (error.message || error), 'error'); }
    finally { setBusy('btnTestApply', false); }
}

function setupPickerHandlers() {
    $('btnInspectPoint')?.addEventListener('click', inspectPoint);
    $('btnScanShadow')?.addEventListener('click', scanShadow);
    $('btnYtSweep')?.addEventListener('click', youtubeSweep);
    $('btnApplyFilter')?.addEventListener('click', applyFilter);
    $('btnCopyFilter')?.addEventListener('click', copyFilter);
    $('btnTestFilter')?.addEventListener('click', testFilter);
    $('btnRemoveFilter')?.addEventListener('click', removePreview);
    $('btnTestApply')?.addEventListener('click', testApply);
}

export { setupPickerHandlers };
