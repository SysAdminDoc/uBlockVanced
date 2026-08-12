/*******************************************************************************

    Element Probe filter history and user-filter persistence.

*/

import {
    $, log, setText, state,
} from './state.js';
import { HIDE_ELEMENT_SCRIPT } from './page-scripts.js';
import { updateWorkflowSummary } from './ui.js';

const HISTORY_KEY = 'elementProbe_filterHistory';

async function saveHistory() {
    try {
        await chrome.storage.local.set({ [HISTORY_KEY]: state.filterHistory });
    } catch ( error ) {
        log('Failed to save history: ' + error, 'error');
    }
}

async function loadHistory() {
    try {
        const data = await chrome.storage.local.get(HISTORY_KEY);
        state.filterHistory = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
    } catch {
        state.filterHistory = [];
    }
    renderHistory();
}

function addToHistory(filter, selector, hostname) {
    const existing = state.filterHistory.find(entry => entry.filter === filter);
    const now = Date.now();
    if ( existing ) {
        existing.selector = selector;
        existing.hostname = hostname;
        existing.timestamp = now;
        existing.active = true;
        state.filterHistory = [ existing, ...state.filterHistory.filter(entry => entry !== existing) ];
    } else {
        state.filterHistory.unshift({ filter, selector, hostname, timestamp: now, active: true });
    }
    state.filterHistory.length = Math.min(state.filterHistory.length, 50);
    saveHistory();
    renderHistory();
}

function renderHistory() {
    const container = $('historyList');
    if ( !container ) { return; }
    while ( container.lastChild ) { container.lastChild.remove(); }
    setText('historyCount', `${state.filterHistory.length} filter${state.filterHistory.length === 1 ? '' : 's'}`);
    container.dataset.empty = state.filterHistory.length === 0 ? 'true' : 'false';
    for ( const [index, entry] of state.filterHistory.entries() ) {
        const item = document.createElement('div');
        item.className = 'history-item' + (entry.active ? '' : ' undone');
        const filter = document.createElement('span');
        filter.className = 'history-filter';
        filter.textContent = entry.filter;
        filter.title = entry.filter;
        const time = document.createElement('span');
        time.className = 'history-time';
        time.textContent = new Date(entry.timestamp).toLocaleTimeString();
        const actions = document.createElement('span');
        actions.className = 'history-actions';
        const toggle = document.createElement('button');
        toggle.className = entry.active ? 'btn-mini danger' : 'btn-mini';
        toggle.textContent = entry.active ? 'Undo' : 'Redo';
        toggle.addEventListener('click', () => entry.active ? undoFilter(index) : reapplyFilter(index));
        const copy = document.createElement('button');
        copy.className = 'btn-mini';
        copy.textContent = 'Copy';
        copy.addEventListener('click', () => navigator.clipboard.writeText(entry.filter).then(
            () => log('Copied: ' + entry.filter, 'success')
        ));
        actions.append(toggle, copy);
        item.append(filter, time, actions);
        container.appendChild(item);
    }
    updateWorkflowSummary();
}

function unhideOnPage(selector) {
    const code = `(function(){try{var e=document.querySelectorAll(${JSON.stringify(selector)});for(var i=0;i<e.length;i++){e[i].style.removeProperty('display');e[i].style.removeProperty('content-visibility');e[i].style.removeProperty('max-height');e[i].style.removeProperty('overflow')}return e.length}catch(e){return -1}})()`;
    return state.evalInPage(code).catch(() => -1);
}

function sendMessageAsync(message) {
    return new Promise(resolve => {
        try {
            chrome.runtime.sendMessage(message, response => {
                const error = chrome.runtime.lastError;
                resolve(error
                    ? { ok: false, error: error.message || String(error) }
                    : { ok: true, response });
            });
        } catch ( error ) {
            resolve({ ok: false, error: error && error.message || String(error) });
        }
    });
}

async function undoFilter(index) {
    const entry = state.filterHistory[index];
    if ( !entry ) { return; }
    const result = await sendMessageAsync({
        what: 'removeUserFilter',
        filters: entry.filter,
        docURL: state.currentPageUrl || undefined,
    });
    if ( state.panelClosed ) { return; }
    if ( result.ok ) {
        log('Filter removed from user filter list: ' + entry.filter, 'success');
    } else {
        const count = await unhideOnPage(entry.selector);
        if ( state.panelClosed ) { return; }
        log(`Un-hid ${count === -1 ? 0 : count} element(s) on page (filter not removed from list — remove manually)`, 'info');
    }
    entry.active = false;
    await saveHistory();
    renderHistory();
}

async function reapplyFilter(index) {
    const entry = state.filterHistory[index];
    if ( !entry ) { return; }
    let persisted = false;
    try {
        const count = await state.evalInPage(HIDE_ELEMENT_SCRIPT(entry.selector));
        if ( state.panelClosed ) { return; }
        if ( count > 0 ) { log('Re-applied: hid ' + count + ' element(s)', 'success'); }
        persisted = await persistFilter(entry.filter);
    } catch ( error ) {
        log('Re-apply failed: ' + error, 'error');
    }
    if ( state.panelClosed ) { return; }
    entry.active = persisted;
    await saveHistory();
    renderHistory();
}

function checkFilterCollision(newFilter) {
    return new Promise(resolve => {
        try {
            chrome.runtime.sendMessage({ what: 'getUserRules' }, response => {
                if ( chrome.runtime.lastError || !response ) { resolve(null); return; }
                const rules = (response.content || '').split('\n').filter(line => line.trim() && !line.startsWith('!'));
                const next = newFilter.match(/^(.+?)(##|#@#)(.+)$/);
                if ( !next ) { resolve(null); return; }
                const collisions = [];
                for ( const rule of rules ) {
                    const current = rule.match(/^(.+?)(##|#@#)(.+)$/);
                    if ( !current ) { continue; }
                    if ( rule === newFilter ) { collisions.push({ type: 'duplicate', rule }); continue; }
                    if (
                        current[1] === next[1] &&
                        current[2] !== next[2] &&
                        current[3] === next[3]
                    ) {
                        collisions.push({ type: 'conflict', rule });
                        continue;
                    }
                    if ( current[3] !== next[3] || current[2] !== next[2] ) { continue; }
                    if ( current[1] === '*' || current[1] === next[1] ) { collisions.push({ type: 'superset', rule }); }
                    else if ( next[1] === '*' ) { collisions.push({ type: 'subset', rule }); }
                }
                resolve(collisions.length ? collisions : null);
            });
        } catch { resolve(null); }
    });
}

function persistFilter(filter) {
    return new Promise(resolve => {
        try {
            chrome.runtime.sendMessage({
                what: 'createUserFilter',
                autoComment: true,
                filters: filter,
                docURL: state.currentPageUrl || undefined,
            }, () => {
                if ( state.panelClosed ) { resolve(false); return; }
                if ( chrome.runtime.lastError ) {
                    log('Could not persist to filter list (copy and add manually)', 'info');
                    resolve(false);
                } else {
                    log('Filter persisted to user filter list', 'success');
                    resolve(true);
                }
            });
        } catch { resolve(false); }
    });
}

function setupHistoryHandlers() {
    $('btnClearHistory')?.addEventListener('click', () => {
        state.filterHistory = [];
        saveHistory();
        renderHistory();
        $('historySearch').value = '';
        log('Filter history cleared', 'info');
    });
    $('historySearch')?.addEventListener('input', event => {
        const query = event.target.value.trim().toLowerCase();
        let visible = 0;
        document.querySelectorAll('#historyList .history-item').forEach(item => {
            const text = item.querySelector('.history-filter')?.textContent.toLowerCase() || '';
            const match = !query || text.includes(query);
            item.classList.toggle('search-hidden', !match);
            if ( match ) { visible += 1; }
        });
        setText('historyCount', query
            ? `${visible} of ${state.filterHistory.length} filter${state.filterHistory.length === 1 ? '' : 's'}`
            : `${state.filterHistory.length} filter${state.filterHistory.length === 1 ? '' : 's'}`);
    });
}

export {
    addToHistory, checkFilterCollision, loadHistory, persistFilter,
    renderHistory, saveHistory, setupHistoryHandlers, undoFilter,
    unhideOnPage,
};
