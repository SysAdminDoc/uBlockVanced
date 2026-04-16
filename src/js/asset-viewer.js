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

/******************************************************************************/

(async ( ) => {
    const subscribeURL = new URL(document.location);
    const subscribeParams = subscribeURL.searchParams;
    const assetKey = subscribeParams.get('url');
    const assetHeading = qs$('#assetHeading');
    const assetMeta = qs$('#assetMeta');
    const assetStatusPrimary = qs$('#assetStatusPrimary');
    const assetTrustState = qs$('#assetTrustState');
    const assetLineCount = qs$('#assetLineCount');
    const assetSourceLink = qs$('#assetSourceLink');
    const subscribeElem = subscribeParams.get('subscribe') !== null
        ? qs$('#subscribe')
        : null;
    const subscribeTitle = qs$('#subscribeTitle');
    const subscribeTarget = qs$('#subscribeTarget');
    const subscribeState = qs$('#subscribeState');
    const subscribeButton = qs$('#subscribeButton');

    const setStatusPill = function(elem, message, tone = 'neutral') {
        if ( elem === null ) { return; }
        dom.text(elem, message);
        elem.dataset.tone = tone;
    };

    const lineCountFromText = text =>
        text === ''
            ? 0
            : text.split(/\r\n|\r|\n/).length;

    const displayTitle = subscribeParams.get('title') || assetKey || i18n$('assetViewerUntitledAsset');
    dom.text(assetHeading, displayTitle);
    dom.text(assetMeta, assetKey || i18n$('assetViewerNoAssetSelected'));

    if ( assetKey === null ) {
        setStatusPill(assetStatusPrimary, i18n$('assetViewerStatusMissing'), 'warning');
        dom.cl.remove(dom.body, 'loading');
        return;
    }

    if ( subscribeElem !== null && subscribeURL.hash !== '#subscribed' ) {
        dom.text(subscribeTitle, displayTitle);
        dom.text(subscribeTarget, assetKey);
        dom.attr(subscribeTarget, 'href', assetKey);
        setStatusPill(
            subscribeState,
            i18n$('assetViewerSubscribePending'),
            'warning'
        );
        dom.cl.remove(subscribeElem, 'hide');
    }

    const cmEditor = new CodeMirror(qs$('#content'), {
        autofocus: true,
        foldGutter: true,
        gutters: [
            'CodeMirror-linenumbers',
            { className: 'CodeMirror-lintgutter', style: 'width: 11px' },
        ],
        lineNumbers: true,
        lineWrapping: true,
        matchBrackets: true,
        maxScanLines: 1,
        maximizable: false,
        readOnly: true,
        styleActiveLine: {
            nonEmpty: true,
        },
    });

    uBlockDashboard.patchCodeMirrorEditor(cmEditor);

    vAPI.messaging.send('dashboard', {
        what: 'getAutoCompleteDetails'
    }).then(hints => {
        if ( hints instanceof Object === false ) { return; }
        cmEditor.setOption('uboHints', hints);
    });

    vAPI.messaging.send('dashboard', {
        what: 'getTrustedScriptletTokens',
    }).then(tokens => {
        cmEditor.setOption('trustedScriptletTokens', tokens);
    });

    let details;
    try {
        details = await vAPI.messaging.send('default', {
            what : 'getAssetContent',
            url: assetKey,
        });
    } catch ( reason ) {
        const message = `${reason instanceof Error ? reason.message : reason || ''}`.trim();
        setStatusPill(assetStatusPrimary, i18n$('assetViewerStatusLoadError'), 'warning');
        setStatusPill(assetTrustState, i18n$('assetViewerStatusUnavailable'), 'muted');
        cmEditor.setValue(
            `${i18n$('assetViewerLoadError')}${message !== '' ? `\n\n${message}` : ''}`
        );
        dom.cl.remove(dom.body, 'loading');
        return;
    }
    const content = details && details.content || '';
    cmEditor.setOption('trustedSource', details.trustedSource === true);
    cmEditor.setValue(content);
    setStatusPill(assetStatusPrimary, i18n$('assetViewerStatusReady'), 'success');
    setStatusPill(
        assetTrustState,
        details.trustedSource === true
            ? i18n$('assetViewerStatusTrusted')
            : i18n$('assetViewerStatusExternal'),
        details.trustedSource === true ? 'success' : 'warning'
    );
    setStatusPill(
        assetLineCount,
        i18n$('assetViewerLineCount')
            .replace('{{count}}', lineCountFromText(content).toLocaleString()),
        'muted'
    );

    if ( subscribeElem !== null ) {
        dom.on(subscribeButton, 'click', async ( ) => {
            subscribeElem.dataset.busy = 'true';
            subscribeButton.disabled = true;
            setStatusPill(
                subscribeState,
                i18n$('assetViewerSubscribeWorking'),
                'running'
            );
            setStatusPill(
                assetStatusPrimary,
                i18n$('assetViewerStatusSubscribing'),
                'running'
            );
            try {
                await vAPI.messaging.send('scriptlets', {
                    what: 'applyFilterListSelection',
                    toImport: assetKey,
                });
                await vAPI.messaging.send('scriptlets', {
                    what: 'reloadAllFilters'
                });
                setStatusPill(
                    subscribeState,
                    i18n$('assetViewerSubscribeDone'),
                    'success'
                );
                setStatusPill(
                    assetStatusPrimary,
                    i18n$('assetViewerStatusSubscribed'),
                    'success'
                );
                window.history.replaceState(null, '', '#subscribed');
            } catch {
                delete subscribeElem.dataset.busy;
                subscribeButton.disabled = false;
                setStatusPill(
                    subscribeState,
                    i18n$('assetViewerSubscribeError'),
                    'warning'
                );
                setStatusPill(
                    assetStatusPrimary,
                    i18n$('assetViewerStatusSubscribeError'),
                    'warning'
                );
                return;
            }
            delete subscribeElem.dataset.busy;
        });
    }

    if ( details.sourceURL ) {
        dom.attr(assetSourceLink, 'href', details.sourceURL);
        dom.cl.remove(assetSourceLink, 'hide');
        const a = qs$('.cm-search-widget .sourceURL');
        if ( a instanceof HTMLAnchorElement ) {
            dom.attr(a, 'href', details.sourceURL);
            dom.attr(a, 'title', details.sourceURL);
            dom.attr(a, 'rel', 'noopener noreferrer');
        }
    }

    dom.cl.remove(dom.body, 'loading');
})();
