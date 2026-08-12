/*******************************************************************************

    Element Probe frame targeting and navigation lifecycle.

*/

import { $, i18n, log, setBusy, setSelectionSummary, setStatus, state } from './state.js';
import { evalInPage, inspectSelected, resetInspectionState } from './inspect.js';
import { syncFilterActions, updateWorkflowSummary } from './ui.js';

const FRAME_SCAN_SCRIPT = `
(function() {
    var frames = document.querySelectorAll('iframe');
    var results = [];
    for (var i = 0; i < frames.length; i++) {
        var f = frames[i];
        var src = '';
        try { src = f.src || f.contentWindow.location.href; } catch(e) { src = f.src || ''; }
        if (!src || src === 'about:blank') continue;
        results.push({ src: src, id: f.id || '', name: f.name || '', dims: f.offsetWidth + 'x' + f.offsetHeight, visible: f.offsetParent !== null || f.offsetWidth > 0 });
    }
    return JSON.stringify(results);
})()`;

async function scanFrames() {
    try {
        const frames = JSON.parse(await evalInPage(FRAME_SCAN_SCRIPT, ''));
        const select = $('frameTarget');
        if ( !select ) { return frames; }
        const previous = select.value;
        while ( select.options.length > 1 ) { select.remove(1); }
        for ( const frame of frames ) {
            const option = document.createElement('option');
            option.value = frame.src;
            let label = '';
            try {
                const url = new URL(frame.src);
                label = url.pathname.replace(/^\//, '').substring(0, 50) || url.hostname;
            } catch { label = frame.src.substring(0, 60); }
            if ( frame.id ) { label = '#' + frame.id + ' - ' + label; }
            else if ( frame.name ) { label = frame.name + ' - ' + label; }
            option.textContent = label + ' [' + frame.dims + ']';
            option.title = frame.src;
            select.appendChild(option);
        }
        if ( previous ) { select.value = previous; }
        updateWorkflowSummary();
        return frames;
    } catch ( error ) {
        log('Frame scan failed: ' + (error.message || error), 'error');
        return [];
    }
}

async function scanIframes() {
    setBusy('btnScanIframes', true, 'Scanning...');
    log('Scanning for iframes...', 'info');
    try {
        const frames = JSON.parse(await evalInPage(FRAME_SCAN_SCRIPT, ''));
        if ( frames.length === 0 ) { log('No iframes found on this page', 'info'); }
        else { log(`Found ${frames.length} iframe(s):`, 'success'); frames.forEach(frame => log(`  ${frame.src} [${frame.dims}]`, 'info')); }
        await scanFrames();
        setStatus('Scan complete', 'active');
    } catch ( error ) { log('iframe scan failed: ' + (error.message || error), 'error'); }
    finally { setBusy('btnScanIframes', false); }
}

function detectYouTube() {
    chrome.devtools.inspectedWindow.eval('location.hostname', (hostname, error) => {
        if ( state.panelClosed || error ) { return; }
        const button = $('btnYtSweep');
        if ( button ) { button.style.display = hostname && hostname.includes('youtube.com') ? '' : 'none'; }
    });
}

function setupFrames() {
    $('frameTarget')?.addEventListener('change', event => {
        state.currentFrameUrl = event.target.value;
        const label = event.target.options[event.target.selectedIndex]?.textContent || 'Top document';
        log(state.currentFrameUrl ? 'Targeting iframe: ' + label : 'Targeting top frame', 'info');
        setStatus(state.currentFrameUrl ? 'Frame: ' + label.substring(0, 30) : i18n('epStatusReady') || 'Ready', 'active');
        setSelectionSummary(state.currentFrameUrl ? 'Inspecting inside ' + label : i18n('epOverviewTargetHint') || 'Targeting the top document.');
    });
    $('btnRefreshFrames')?.addEventListener('click', async () => {
        log('Refreshing iframe list...', 'info');
        const frames = await scanFrames();
        log('Found ' + frames.length + ' iframe(s)', frames.length ? 'success' : 'info');
    });
    $('btnScanIframes')?.addEventListener('click', scanIframes);
    if ( chrome.devtools?.panels?.elements ) {
        let timer;
        chrome.devtools.panels.elements.onSelectionChanged.addListener(() => {
            if ( state.panelClosed ) { return; }
            if ( timer !== undefined ) { clearTimeout(timer); }
            timer = setTimeout(() => {
                timer = undefined;
                if ( state.panelClosed ) { return; }
                log('Element selection changed', 'info');
                inspectSelected();
            }, 120);
        });
    }
    if ( chrome.devtools?.inspectedWindow?.onNavigated ) {
        chrome.devtools.inspectedWindow.onNavigated.addListener(() => {
            if ( state.panelClosed ) { return; }
            resetInspectionState();
            setStatus(i18n('epStatusReady') || 'Ready', 'idle');
            setSelectionSummary(i18n('epNoElementSelected') || 'No element selected yet.');
            syncFilterActions();
            log('Page navigated — state reset', 'info');
            scanFrames();
            detectYouTube();
        });
    }
}

export { detectYouTube, scanFrames, setupFrames };
