/*******************************************************************************

    Shared state and small DOM helpers for the Element Probe DevTools panel.

*/

import { DEFAULT_CLASS_PATTERNS } from './page-scripts.js';

const $ = id => document.getElementById(id);
const i18n = key => chrome.i18n.getMessage(key) || '';

const state = {
    panelClosed: false,
    currentSelectors: [],
    selectedSelectorIndex: -1,
    currentHostname: '',
    currentPageUrl: '',
    isHighlighting: false,
    lastInspectedData: null,
    currentFrameUrl: '',
    filterHistory: [],
    activeClassPatterns: DEFAULT_CLASS_PATTERNS,
    evalInPage: async () => undefined,
};

function renderI18n() {
    for ( const el of document.querySelectorAll('[data-i18n]') ) {
        const text = i18n(el.getAttribute('data-i18n'));
        if ( text ) { el.textContent = text; }
    }
    for ( const el of document.querySelectorAll('[data-i18n-title]') ) {
        const text = i18n(el.getAttribute('data-i18n-title'));
        if ( text ) { el.title = text; }
    }
    for ( const el of document.querySelectorAll('[data-i18n-placeholder]') ) {
        const text = i18n(el.getAttribute('data-i18n-placeholder'));
        if ( text ) { el.placeholder = text; }
    }
}

function setStatus(text, status = '') {
    if ( state.panelClosed ) { return; }
    const statusText = $('statusText');
    if ( statusText ) { statusText.textContent = text; }
    const dot = $('statusDot');
    if ( dot ) {
        dot.className = 'status-dot';
        if ( status ) { dot.classList.add(status); }
    }
    const indicator = document.querySelector('.status-indicator');
    if ( indicator ) { indicator.dataset.state = status || 'idle'; }
}

function setText(id, text) {
    const node = $(id);
    if ( node ) { node.textContent = text; }
}

function truncate(text, max = 88) {
    if ( typeof text !== 'string' ) { return ''; }
    const normalized = text.replace(/\s+/g, ' ').trim();
    return normalized.length <= max
        ? normalized
        : normalized.slice(0, max - 1) + '\u2026';
}

function getCurrentFrameLabel() {
    const select = $('frameTarget');
    if ( select && state.currentFrameUrl ) {
        const option = select.options[select.selectedIndex];
        if ( option && option.textContent ) { return option.textContent.trim(); }
        return 'Selected iframe';
    }
    return 'Top document';
}

function formatSelectionLabel(data) {
    if ( !data ) { return 'Waiting for a node'; }
    const label = [];
    if ( data.tag ) { label.push(`<${data.tag}>`); }
    if ( data.id ) { label.push(`#${data.id}`); }
    if ( Array.isArray(data.classes) && data.classes.length !== 0 ) {
        label.push(`.${data.classes[0]}`);
    }
    return label.join(' ') || 'Selected element';
}

function syncLogState() {
    const node = $('log');
    if ( node ) { node.dataset.empty = node.childElementCount === 0 ? 'true' : 'false'; }
}

function log(message, type = '') {
    if ( state.panelClosed ) { return; }
    const node = $('log');
    if ( !node ) { return; }
    const entry = document.createElement('div');
    entry.className = 'log-entry' + (type ? ` ${type}` : '');
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    node.appendChild(entry);
    while ( node.childElementCount > 120 ) { node.firstElementChild.remove(); }
    node.scrollTop = node.scrollHeight;
    syncLogState();
}

function setSelectionSummary(text) {
    setText('selectionSummary', text);
    if ( typeof state.updateWorkflowSummary === 'function' ) {
        state.updateWorkflowSummary();
    }
}

function setBusy(buttonId, busy, busyText) {
    const button = $(buttonId);
    if ( !button ) { return; }
    if ( !button.dataset.label ) { button.dataset.label = button.textContent; }
    button.disabled = busy;
    button.classList.toggle('is-busy', busy);
    button.textContent = busy ? busyText : button.dataset.label;
}

window.addEventListener('pagehide', () => { state.panelClosed = true; }, { once: true });
window.addEventListener('unload', () => { state.panelClosed = true; }, { once: true });

export {
    $, i18n, log, formatSelectionLabel, getCurrentFrameLabel, renderI18n,
    setBusy, setSelectionSummary, setStatus, setText, state, syncLogState,
    truncate,
};

