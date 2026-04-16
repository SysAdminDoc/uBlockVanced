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
import { i18n$ } from './i18n.js';

/******************************************************************************/

(async ( ) => {
    const appData = await vAPI.messaging.send('dashboard', {
        what: 'getAppData',
    });

    dom.text('#aboutNameVer', appData.name);
    dom.text(
        '#aboutVersionBadge',
        i18n$('aboutVersionBadge').replace('{{version}}', appData.version)
    );

    for ( const link of document.querySelectorAll('a[href^="http"]') ) {
        if ( link instanceof HTMLAnchorElement === false ) { continue; }
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
    }

    const leadLink = qs$('.about-note a');
    if ( leadLink instanceof HTMLAnchorElement ) {
        const label = i18n$('genericOpenDocumentation');
        leadLink.title = label;
        leadLink.setAttribute('aria-label', label);
    }
})();
