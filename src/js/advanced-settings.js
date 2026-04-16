/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2016-present Raymond Hill

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

import { dom, qs$ } from './dom.js';
import { i18n$ } from './i18n.js';

/******************************************************************************/

let defaultSettings = new Map();
let adminSettings = new Map();
let beforeHash = '';
let isApplying = false;
let isRendering = false;
let saveStateOverride;

/******************************************************************************/

CodeMirror.defineMode('raw-settings', function() {
    let lastSetting = '';

    return {
        token: function(stream) {
            if ( stream.sol() ) {
                stream.eatSpace();
                const match = stream.match(/\S+/);
                if ( match !== null && defaultSettings.has(match[0]) ) {
                    lastSetting = match[0];
                    return adminSettings.has(match[0])
                        ? 'readonly keyword'
                        : 'keyword';
                }
                stream.skipToEnd();
                return 'line-cm-error';
            }
            stream.eatSpace();
            const match = stream.match(/.*$/);
            if ( match !== null ) {
                if ( match[0].trim() !== defaultSettings.get(lastSetting) ) {
                    return 'line-cm-strong';
                }
                if ( adminSettings.has(lastSetting) ) {
                    return 'readonly';
                }
            }
            stream.skipToEnd();
            return null;
        }
    };
});

const cmEditor = new CodeMirror(qs$('#advancedSettings'), {
    autofocus: true,
    lineNumbers: true,
    lineWrapping: false,
    styleActiveLine: true
});

uBlockDashboard.patchCodeMirrorEditor(cmEditor);

/******************************************************************************/

const hashFromAdvancedSettings = function(raw) {
    const aa = typeof raw === 'string'
        ? arrayFromString(raw)
        : arrayFromObject(raw);
    aa.sort((a, b) => a[0].localeCompare(b[0]));
    return JSON.stringify(aa);
};

/******************************************************************************/

const setStatusPill = function(target, message, tone) {
    const node = qs$(target);
    if ( node === null ) { return; }
    node.textContent = message;
    node.className = 'statusPill';
    if ( tone ) {
        dom.cl.add(node, tone);
    }
};

const countCustomizedSettings = function(raw) {
    let count = 0;
    for ( const [ key, value ] of arrayFromString(raw) ) {
        if ( defaultSettings.has(key) === false ) { continue; }
        if ( value !== defaultSettings.get(key) ) {
            count += 1;
        }
    }
    return count;
};

const updatePolicyHint = function() {
    const hint = qs$('#advancedSettingsPolicyHint');
    if ( hint === null ) { return; }
    const template = i18n$(
        adminSettings.size !== 0
            ? 'advancedSettingsPolicyHintLocked'
            : 'advancedSettingsPolicyHintClear'
    );
    hint.textContent = template
        .replace('{{count}}', adminSettings.size)
        .replace('{{total}}', defaultSettings.size);
};

const updateEditorState = function() {
    const changed = hashFromAdvancedSettings(cmEditor.getValue()) !== beforeHash;
    const customizedCount = countCustomizedSettings(cmEditor.getValue());

    let saveKey, saveTone;
    if ( saveStateOverride instanceof Object ) {
        saveKey = saveStateOverride.key;
        saveTone = saveStateOverride.tone;
    } else if ( isApplying ) {
        saveKey = 'advancedSettingsStatusSaving';
        saveTone = 'is-accent';
    } else if ( changed ) {
        saveKey = 'advancedSettingsStatusUnsaved';
        saveTone = 'is-warning';
    } else {
        saveKey = 'advancedSettingsStatusSaved';
        saveTone = 'is-success';
    }

    setStatusPill('#advancedSettingsSaveState', i18n$(saveKey), saveTone);
    setStatusPill(
        '#advancedSettingsCustomizedState',
        i18n$('advancedSettingsCustomizedCount')
            .replace('{{count}}', customizedCount),
        customizedCount !== 0
            ? 'is-accent'
            : 'is-muted'
    );
    setStatusPill(
        '#advancedSettingsLockState',
        i18n$(
            adminSettings.size !== 0
                ? 'advancedSettingsLockCount'
                : 'advancedSettingsLockCountNone'
        ).replace('{{count}}', adminSettings.size),
        adminSettings.size !== 0 ? 'is-warning' : 'is-muted'
    );

    qs$('#advancedSettingsApply').disabled = changed === false || isApplying;
    qs$('#advancedSettingsRevert').disabled = changed === false || isApplying;
    qs$('#advancedSettingsApply').dataset.busy = isApplying ? 'true' : 'false';
    CodeMirror.commands.save = changed && isApplying === false
        ? applyChanges
        : function(){};
    dom.attr('#advancedSettings', 'data-dirty', changed ? 'true' : 'false');
};

const arrayFromObject = function(o) {
    const out = [];
    for ( const k in o ) {
        if ( Object.hasOwn(o, k) === false ) { continue; }
        out.push([ k, `${o[k]}` ]);
    }
    return out;
};

const arrayFromString = function(s) {
    const out = [];
    for ( let line of s.split(/[\n\r]+/) ) {
        line = line.trim();
        if ( line === '' ) { continue; }
        const pos = line.indexOf(' ');
        let k, v;
        if ( pos !== -1 ) {
            k = line.slice(0, pos);
            v = line.slice(pos + 1);
        } else {
            k = line;
            v = '';
        }
        out.push([ k.trim(), v.trim() ]);
    }
    return out;
};

/******************************************************************************/

const advancedSettingsChanged = (( ) => {
    const handler = ( ) => {
        saveStateOverride = undefined;
        updateEditorState();
    };

    const timer = vAPI.defer.create(handler);

    return function() {
        if ( isRendering ) { return; }
        timer.offon(200);
    };
})();

cmEditor.on('changes', advancedSettingsChanged);

/******************************************************************************/

const renderAdvancedSettings = async function(first) {
    const details = await vAPI.messaging.send('dashboard', {
        what: 'readHiddenSettings',
    });
    isRendering = true;
    try {
        defaultSettings = new Map(arrayFromObject(details.default));
        adminSettings = new Map(arrayFromObject(details.admin));
        beforeHash = hashFromAdvancedSettings(details.current);
        const pretty = [];
        const roLines = [];
        const entries = arrayFromObject(details.current);
        let max = 0;
        for ( const [ k ] of entries ) {
            if ( k.length > max ) { max = k.length; }
        }
        for ( let i = 0; i < entries.length; i++ ) {
            const [ k, v ] = entries[i];
            pretty.push(' '.repeat(max - k.length) + `${k} ${v}`);
            if ( adminSettings.has(k) ) {
                roLines.push(i);
            }
        }
        pretty.push('');
        cmEditor.setValue(pretty.join('\n'));
        if ( first ) {
            cmEditor.clearHistory();
        }
        for ( const line of roLines ) {
            cmEditor.markText(
                { line, ch: 0 },
                { line: line + 1, ch: 0 },
                { readOnly: true }
            );
        }
        updatePolicyHint();
        updateEditorState();
        cmEditor.focus();
    } finally {
        isRendering = false;
    }
};

/******************************************************************************/

const applyChanges = async function() {
    isApplying = true;
    saveStateOverride = undefined;
    updateEditorState();
    try {
        await vAPI.messaging.send('dashboard', {
            what: 'writeHiddenSettings',
            content: cmEditor.getValue(),
        });
        isApplying = false;
        saveStateOverride = {
            key: 'advancedSettingsStatusApplied',
            tone: 'is-success',
        };
        renderAdvancedSettings();
    } catch {
        isApplying = false;
        saveStateOverride = {
            key: 'advancedSettingsStatusSaveError',
            tone: 'is-warning',
        };
        updateEditorState();
    }
};

/******************************************************************************/

dom.on('#advancedSettings', 'input', advancedSettingsChanged);
dom.on('#advancedSettingsApply', 'click', ( ) => {
    applyChanges();
});
dom.on('#advancedSettingsRevert', 'click', ( ) => {
    saveStateOverride = {
        key: 'advancedSettingsStatusReverted',
        tone: 'is-muted',
    };
    renderAdvancedSettings();
});

renderAdvancedSettings(true);

/******************************************************************************/
