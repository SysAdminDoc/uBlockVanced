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

import { dom, qs$ } from './dom.js';

/******************************************************************************/

function discardUnsavedData(synchronous = false) {
    const paneFrame = qs$('#iframe');
    const paneWindow = paneFrame.contentWindow;
    if (
        typeof paneWindow.hasUnsavedData !== 'function' ||
        paneWindow.hasUnsavedData() === false
    ) {
        return true;
    }

    if ( synchronous ) {
        return false;
    }

    return new Promise(resolve => {
        const modal = qs$('#unsavedWarning');
        dom.cl.add(modal, 'on');
        const stayButton = qs$(modal, '[data-i18n="dashboardUnsavedWarningStay"]');
        stayButton?.focus();

        const onDone = status => {
            dom.cl.remove(modal, 'on');
            dom.off(document, 'click', onClick, true);
            dom.off(document, 'keydown', onKeydown, true);
            resolve(status);
        };

        const onClick = ev => {
            const target = ev.target;
            if ( target.matches('[data-i18n="dashboardUnsavedWarningStay"]') ) {
                return onDone(false);
            }
            if ( target.matches('[data-i18n="dashboardUnsavedWarningIgnore"]') ) {
                return onDone(true);
            }
            if ( qs$(modal, '[data-i18n="dashboardUnsavedWarning"]').contains(target) ) {
                return;
            }
            onDone(false);
        };

        const onKeydown = ev => {
            if ( ev.key === 'Escape' ) {
                ev.preventDefault();
                onDone(false);
            }
        };

        dom.on(document, 'click', onClick, true);
        dom.on(document, 'keydown', onKeydown, true);
    });
}

function loadDashboardPanel(pane, first) {
    const tabButton = qs$(`[data-pane="${pane}"]`);
    if ( tabButton === null || dom.cl.has(tabButton, 'selected') ) { return; }
    const loadPane = ( ) => {
        self.location.replace(`#${pane}`);
        document.querySelectorAll('.tabButton').forEach(button => {
            const selected = button === tabButton;
            dom.cl.toggle(button, 'selected', selected);
            dom.attr(button, 'aria-selected', selected ? 'true' : 'false');
            button.tabIndex = selected ? 0 : -1;
        });
        tabButton.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const iframe = qs$('#iframe');
        iframe.title = tabButton.textContent.trim() || 'Dashboard content';
        iframe.contentWindow.location.replace(pane);
        if ( pane !== 'no-dashboard.html' ) {
            vAPI.localStorage.setItem('dashboardLastVisitedPane', pane);
        }
    };
    if ( first ) {
        return loadPane();
    }
    const r = discardUnsavedData();
    if ( r === false ) { return; }
    if ( r === true ) { return loadPane(); }
    r.then(status => {
        if ( status === false ) { return; }
        loadPane();
    });
}

function onTabClickHandler(ev) {
    loadDashboardPanel(dom.attr(ev.target, 'data-pane'));
}

function getVisibleTabs() {
    return Array.from(document.querySelectorAll('.tabButton')).filter(button =>
        button.offsetParent !== null
    );
}

function onTabKeydownHandler(ev) {
    const tabs = getVisibleTabs();
    const current = ev.currentTarget;
    const index = tabs.indexOf(current);
    if ( index === -1 ) { return; }

    let next = null;
    switch ( ev.key ) {
    case 'ArrowLeft':
    case 'ArrowUp':
        next = tabs[(index - 1 + tabs.length) % tabs.length];
        break;
    case 'ArrowRight':
    case 'ArrowDown':
        next = tabs[(index + 1) % tabs.length];
        break;
    case 'Home':
        next = tabs[0];
        break;
    case 'End':
        next = tabs[tabs.length - 1];
        break;
    case 'Enter':
    case ' ':
        loadDashboardPanel(dom.attr(current, 'data-pane'));
        ev.preventDefault();
        return;
    default:
        return;
    }

    ev.preventDefault();
    next.focus();
    loadDashboardPanel(dom.attr(next, 'data-pane'));
}

if ( self.location.hash.slice(1) === 'no-dashboard.html' ) {
    dom.cl.add(dom.body, 'noDashboard');
}

(async ( ) => {
    // Wait for uBO's main process to be ready
    await new Promise(resolve => {
        const check = async ( ) => {
            try {
                const response = await vAPI.messaging.send('dashboard', {
                    what: 'readyToFilter'
                });
                if ( response ) { return resolve(true); }
                const iframe = qs$('#iframe');
                if ( iframe.src !== '' ) {
                    iframe.src = '';
                }
            } catch {
            }
            vAPI.defer.once(250).then(( ) => check());
        };
        check();
    });

    dom.cl.remove(dom.body, 'notReady');

    const results = await Promise.all([
        // https://github.com/uBlockOrigin/uBlock-issues/issues/106
        vAPI.messaging.send('dashboard', { what: 'dashboardConfig' }),
        vAPI.localStorage.getItemAsync('dashboardLastVisitedPane'),
    ]);

    {
        const details = results[0] || {};
        if ( details.noDashboard ) {
            self.location.hash = '#no-dashboard.html';
            dom.cl.add(dom.body, 'noDashboard');
        } else if ( self.location.hash === '#no-dashboard.html' ) {
            self.location.hash = '';
        }
    }

    {
        let pane = results[1] || null;
        if ( self.location.hash !== '' ) {
            pane = self.location.hash.slice(1) || null;
        }
        loadDashboardPanel(pane !== null ? pane : 'settings.html', true);

        dom.on('.tabButton', 'click', onTabClickHandler);
        dom.on('.tabButton', 'keydown', onTabKeydownHandler);

        // https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event
        dom.on(self, 'beforeunload', ( ) => {
            if ( discardUnsavedData(true) ) { return; }
            event.preventDefault();
            event.returnValue = '';
        });

        // https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event
        dom.on(self, 'hashchange', ( ) => {
            const pane = self.location.hash.slice(1);
            if ( pane === '' ) { return; }
            loadDashboardPanel(pane);
        });

    }
})();
