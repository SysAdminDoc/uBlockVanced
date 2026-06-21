/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2014-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/* global CodeMirror, uBlockDashboard */

import './codemirror/ubo-static-filtering.js';
import { dom, qs$ } from './dom.js';
import { i18n$ } from './i18n.js';
import { onBroadcast } from './broadcast.js';

/******************************************************************************/

const cmEditor = new CodeMirror(qs$('#userFilters'), {
    autoCloseBrackets: true,
    autofocus: true,
    extraKeys: {
        'Ctrl-Space': 'autocomplete',
        'Tab': 'toggleComment',
    },
    foldGutter: true,
    gutters: [
        'CodeMirror-linenumbers',
        { className: 'CodeMirror-lintgutter', style: 'width: 11px' },
    ],
    lineNumbers: true,
    lineWrapping: true,
    matchBrackets: true,
    maxScanLines: 1,
    styleActiveLine: {
        nonEmpty: true,
    },
});

uBlockDashboard.patchCodeMirrorEditor(cmEditor);

/******************************************************************************/

// Add auto-complete ability to the editor. Polling is used as the suggested
// hints also depend on the tabs currently opened.

{
    let hintUpdateToken = 0;

    const getHints = async function() {
        const hints = await vAPI.messaging.send('dashboard', {
            what: 'getAutoCompleteDetails',
            hintUpdateToken
        });
        if ( hints instanceof Object === false ) { return; }
        if ( hints.hintUpdateToken !== undefined ) {
            cmEditor.setOption('uboHints', hints);
            hintUpdateToken = hints.hintUpdateToken;
        }
        timer.on(2503);
    };

    const timer = vAPI.defer.create(( ) => {
        getHints();
    });

    getHints();
}

vAPI.messaging.send('dashboard', {
    what: 'getTrustedScriptletTokens',
}).then(tokens => {
    cmEditor.setOption('trustedScriptletTokens', tokens);
});

/******************************************************************************/

let originalState = {
    enabled: true,
    trusted: false,
    filters: '',
};

function setStatusPill(target, message, tone) {
    const node = qs$(target);
    if ( node === null ) { return; }
    node.textContent = message;
    node.className = 'statusPill';
    if ( tone ) {
        dom.cl.add(node, tone);
    }
}

function getCurrentState() {
    const enabled = qs$('#enableMyFilters input').checked;
    return {
        enabled,
        trusted: qs$('#trustMyFilters input').checked,
        filters: getEditorText(),
    };
}

function rememberCurrentState() {
    originalState = getCurrentState();
}

function currentStateChanged() {
    return JSON.stringify(getCurrentState()) !== JSON.stringify(originalState);
}

function getEditorText() {
    const text = cmEditor.getValue().trimEnd();
    return text === '' ? text : `${text}\n`;
}

function setEditorText(text) {
    cmEditor.setValue(`${text.trimEnd()}\n\n`);
}

/******************************************************************************/

function syncEditorState(changed) {
    const enabled = qs$('#enableMyFilters input').checked;
    const trustedInput = qs$('#trustMyFilters input');
    const exportButton = qs$('#exportUserFiltersToFile');
    const trustWarning = qs$('.trustWarning');
    const hasContent = getEditorText().trim() !== '';

    trustedInput.disabled = enabled === false;
    dom.cl.toggle('#trustMyFilters', 'is-disabled', enabled === false);
    dom.cl.toggle(trustWarning, 'is-visible', enabled && trustedInput.checked);
    exportButton.disabled = hasContent === false;

    setStatusPill(
        '#userFiltersSaveState',
        i18n$(changed ? '1pEditorStatusUnsaved' : '1pEditorStatusSaved'),
        changed ? 'is-warning' : 'is-success'
    );
    setStatusPill(
        '#userFiltersEnabledState',
        i18n$(enabled ? '1pEditorStateEnabled' : '1pEditorStateDisabled'),
        enabled ? '' : 'is-muted'
    );
    setStatusPill(
        '#userFiltersTrustState',
        i18n$(
            enabled && trustedInput.checked
                ? '1pEditorTrustEnabled'
                : '1pEditorTrustStandard'
        ),
        enabled && trustedInput.checked ? 'is-accent' : 'is-muted'
    );
}

/******************************************************************************/

function userFiltersChanged(details = {}) {
    const changed = typeof details.changed === 'boolean'
        ? details.changed
        : self.hasUnsavedData();
    qs$('#userFiltersApply').disabled = !changed;
    qs$('#userFiltersRevert').disabled = !changed;
    syncEditorState(changed);
    const enabled = qs$('#enableMyFilters input').checked;
    const trustedbefore = cmEditor.getOption('trustedSource');
    const trustedAfter = enabled && qs$('#trustMyFilters input').checked;
    if ( trustedAfter === trustedbefore ) { return; }
    cmEditor.startOperation();
    cmEditor.setOption('trustedSource', trustedAfter);
    const doc = cmEditor.getDoc();
    const history = doc.getHistory();
    const selections = doc.listSelections();
    doc.replaceRange(doc.getValue(),
        { line: 0, ch: 0 },
        { line: doc.lineCount(), ch: 0 }
    );
    doc.setSelections(selections);
    doc.setHistory(history);
    cmEditor.endOperation();
    cmEditor.focus();
}

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/3704
//   Merge changes to user filters occurring in the background with changes
//   made in the editor. The code assumes that no deletion occurred in the
//   background.

function threeWayMerge(newContent) {
    const prvContent = originalState.filters.trim().split(/\n/);
    const differ = new self.diff_match_patch();
    const newChanges = differ.diff(
        prvContent,
        newContent.trim().split(/\n/)
    );
    const usrChanges = differ.diff(
        prvContent,
        getEditorText().trim().split(/\n/)
    );
    const out = [];
    let i = 0, j = 0, k = 0;
    while ( i < prvContent.length ) {
        for ( ; j < newChanges.length; j++ ) {
            const change = newChanges[j];
            if ( change[0] !== 1 ) { break; }
            out.push(change[1]);
        }
        for ( ; k < usrChanges.length; k++ ) {
            const change = usrChanges[k];
            if ( change[0] !== 1 ) { break; }
            out.push(change[1]);
        }
        if ( k === usrChanges.length || usrChanges[k][0] !== -1 ) {
            out.push(prvContent[i]);
        }
        i += 1; j += 1; k += 1;
    }
    for ( ; j < newChanges.length; j++ ) {
        const change = newChanges[j];
        if ( change[0] !== 1 ) { continue; }
        out.push(change[1]);
    }
    for ( ; k < usrChanges.length; k++ ) {
        const change = usrChanges[k];
        if ( change[0] !== 1 ) { continue; }
        out.push(change[1]);
    }
    return out.join('\n');
}

/******************************************************************************/

async function renderUserFilters() {
    const details = await vAPI.messaging.send('dashboard', {
        what: 'readUserFilters',
    });
    if ( details instanceof Object === false || details.error ) { return; }

    cmEditor.setOption('trustedSource', details.trusted);

    qs$('#enableMyFilters input').checked = details.enabled;
    qs$('#trustMyFilters input').checked = details.trusted;

    setEditorText(details.content.trim());
    userFiltersChanged({ changed: false });

    rememberCurrentState();
}

/******************************************************************************/

function handleImportFilePicker(ev) {
    const file = ev.target.files[0];
    if ( file === undefined || file.name === '' ) { return; }
    if ( file.type.indexOf('text') !== 0 ) { return; }
    const fr = new FileReader();
    fr.onload = function() {
        if ( typeof fr.result !== 'string' ) { return; }
        const content = uBlockDashboard.mergeNewLines(getEditorText(), fr.result);
        cmEditor.operation(( ) => {
            const cmPos = cmEditor.getCursor();
            setEditorText(content);
            cmEditor.setCursor(cmPos);
            cmEditor.focus();
        });
    };
    fr.readAsText(file);
}

dom.on('#importFilePicker', 'change', handleImportFilePicker);

function startImportFilePicker() {
    const input = qs$('#importFilePicker');
    // Reset to empty string, this will ensure an change event is properly
    // triggered if the user pick a file, even if it is the same as the last
    // one picked.
    input.value = '';
    input.click();
}

dom.on('#importUserFiltersFromFile', 'click', startImportFilePicker);

/******************************************************************************/

function exportUserFiltersToFile() {
    const val = getEditorText();
    if ( val === '' ) { return; }
    const filename = i18n$('1pExportFilename')
        .replace('{{datetime}}', uBlockDashboard.dateNowToSensibleString())
        .replace(/ +/g, '_');
    vAPI.download({
        'url': `data:text/plain;charset=utf-8,${encodeURIComponent(val)}`,
        'filename': filename
    });
}

function exportUserFiltersToJSON() {
    const val = getEditorText();
    if ( val === '' ) { return; }
    const lines = val.split('\n');
    const rules = [];
    for ( const line of lines ) {
        const trimmed = line.trim();
        if ( trimmed === '' || trimmed.startsWith('!') ) { continue; }
        const entry = { raw: trimmed };
        const cosmetic = trimmed.match(/^(.+?)(##|#@#)(.+)$/);
        if ( cosmetic ) {
            entry.type = cosmetic[2] === '#@#' ? 'exception' : 'cosmetic';
            entry.domains = cosmetic[1];
            entry.selector = cosmetic[3];
        } else if ( trimmed.startsWith('||') || trimmed.startsWith('@@') ) {
            entry.type = trimmed.startsWith('@@') ? 'exception' : 'network';
        } else {
            entry.type = 'other';
        }
        rules.push(entry);
    }
    const data = {
        format: 'uBlockVanced-filters',
        version: '1.0',
        exportedAt: new Date().toISOString(),
        filterCount: rules.length,
        rules,
    };
    const json = JSON.stringify(data, null, 2);
    const filename = 'uBlockVanced-filters_'
        + uBlockDashboard.dateNowToSensibleString().replace(/ +/g, '_')
        + '.json';
    vAPI.download({
        'url': `data:application/json;charset=utf-8,${encodeURIComponent(json)}`,
        'filename': filename
    });
}

/******************************************************************************/

async function applyChanges() {
    const state = getCurrentState();
    const details = await vAPI.messaging.send('dashboard', {
        what: 'writeUserFilters',
        content: state.filters,
        enabled: state.enabled,
        trusted: state.trusted,
    });
    if ( details instanceof Object === false || details.error ) { return; }
    rememberCurrentState();
    userFiltersChanged({ changed: false });
    vAPI.messaging.send('dashboard', {
        what: 'reloadAllFilters',
    });
}

function revertChanges() {
    qs$('#enableMyFilters input').checked = originalState.enabled;
    qs$('#trustMyFilters input').checked = originalState.trusted;
    setEditorText(originalState.filters);
    userFiltersChanged();
}

/******************************************************************************/

function getCloudData() {
    return getEditorText();
}

function setCloudData(data, append) {
    if ( typeof data !== 'string' ) { return; }
    if ( append ) {
        data = uBlockDashboard.mergeNewLines(getEditorText(), data);
    }
    cmEditor.setValue(data);
    userFiltersChanged();
}

self.cloud.onPush = getCloudData;
self.cloud.onPull = setCloudData;

self.hasUnsavedData = function() {
    return currentStateChanged();
};

/******************************************************************************/

let deadDomainAbort = null;
async function checkDeadDomains() {
    if ( deadDomainAbort ) { deadDomainAbort.abort(); }
    const btn = qs$('#checkDeadDomains');
    if ( btn ) { btn.disabled = true; }
    const text = getEditorText();
    const lines = text.split('\n');
    const domainRe = /^([a-zA-Z0-9][\w.-]+\.\w{2,})(##|#@#|\$|,|\^)/;
    const domains = new Set();
    for ( const line of lines ) {
        if ( line.startsWith('!') || line.startsWith('[') || line.trim() === '' ) continue;
        const m = line.match(domainRe);
        if ( m && m[1] !== '*' ) { domains.add(m[1]); }
    }
    if ( domains.size === 0 ) {
        const st = qs$('#userFiltersSaveState');
        if ( st ) { st.textContent = 'No domains found in filters'; }
        if ( btn ) { btn.disabled = false; }
        return;
    }
    const MAX_DOMAINS = 100;
    if ( domains.size > MAX_DOMAINS ) {
        const st = qs$('#userFiltersSaveState');
        if ( st ) { st.textContent = `Too many domains (${domains.size}). Max ${MAX_DOMAINS}.`; }
        if ( btn ) { btn.disabled = false; }
        return;
    }
    deadDomainAbort = new AbortController();
    const { signal } = deadDomainAbort;
    const dead = [];
    const st = qs$('#userFiltersSaveState');
    let checked = 0;
    for ( const domain of domains ) {
        if ( signal.aborted ) { break; }
        checked++;
        if ( st ) { st.textContent = `Checking ${checked}/${domains.size}...`; }
        try {
            await fetch(`https://${domain}/`, {
                method: 'HEAD',
                mode: 'no-cors',
                signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
            });
        } catch {
            if ( signal.aborted ) { break; }
            try {
                await fetch(`http://${domain}/`, {
                    method: 'HEAD',
                    mode: 'no-cors',
                    signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
                });
            } catch {
                if ( !signal.aborted ) { dead.push(domain); }
            }
        }
    }
    deadDomainAbort = null;
    if ( st ) {
        st.textContent = dead.length > 0
            ? `${dead.length} dead domain(s): ${dead.join(', ')}`
            : `All ${domains.size} domains are reachable`;
    }
    if ( dead.length > 0 ) {
        for ( let i = 0; i < cmEditor.lineCount(); i++ ) {
            const lineText = cmEditor.getLine(i);
            for ( const d of dead ) {
                if ( lineText.startsWith(d + '##') || lineText.startsWith(d + '#@#') || lineText.startsWith(d + '$') || lineText.startsWith(d + '^') ) {
                    cmEditor.addLineClass(i, 'background', 'dead-domain-line');
                }
            }
        }
    }
    if ( btn ) { btn.disabled = false; }
}

// Handle user interaction
dom.on('#checkDeadDomains', 'click', checkDeadDomains);
dom.on('#exportUserFiltersToFile', 'click', exportUserFiltersToFile);
dom.on('#exportUserFiltersToJSON', 'click', exportUserFiltersToJSON);
dom.on('#userFiltersApply', 'click', ( ) => { applyChanges(); });
dom.on('#userFiltersRevert', 'click', revertChanges);
dom.on('#enableMyFilters input', 'change', userFiltersChanged);
dom.on('#trustMyFilters input', 'change', userFiltersChanged);

(async ( ) => {
    await renderUserFilters();

    cmEditor.clearHistory();

    // https://github.com/gorhill/uBlock/issues/3706
    //   Save/restore cursor position
    {
        const line = await vAPI.localStorage.getItemAsync('myFiltersCursorPosition');
        if ( typeof line === 'number' ) {
            cmEditor.setCursor(line, 0);
        }
        cmEditor.focus();
    }

    // https://github.com/gorhill/uBlock/issues/3706
    //   Save/restore cursor position
    {
        let curline = 0;
        cmEditor.on('cursorActivity', ( ) => {
            if ( timer.ongoing() ) { return; }
            if ( cmEditor.getCursor().line === curline ) { return; }
            timer.on(701);
        });
        const timer = vAPI.defer.create(( ) => {
            curline = cmEditor.getCursor().line;
            vAPI.localStorage.setItem('myFiltersCursorPosition', curline);
        });
    }

    // https://github.com/gorhill/uBlock/issues/3704
    //   Merge changes to user filters occurring in the background
    onBroadcast(msg => {
        switch ( msg.what ) {
        case 'userFiltersUpdated': {
            cmEditor.startOperation();
            const scroll = cmEditor.getScrollInfo();
            const selections = cmEditor.listSelections();
            const shouldMerge = self.hasUnsavedData();
            const beforeContent = getEditorText();
            renderUserFilters().then(( ) => {
                if ( shouldMerge ) {
                    setEditorText(threeWayMerge(beforeContent));
                    userFiltersChanged({ changed: true });
                }
                cmEditor.clearHistory();
                cmEditor.setSelection(selections[0].anchor, selections[0].head);
                cmEditor.scrollTo(scroll.left, scroll.top);
                cmEditor.endOperation();
            });
            break;
        }
        default:
            break;
        }
    });
})();

cmEditor.on('changes', userFiltersChanged);
CodeMirror.commands.save = applyChanges;

/******************************************************************************/
