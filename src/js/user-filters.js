/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker

    This file is part of uBlockVanced.

******************************************************************************/

const disabledSites = new Set();

const normalizeHostname = value => {
    if ( typeof value !== 'string' ) { return; }
    let hostname = value.trim().toLowerCase();
    if ( hostname === '' ) { return; }

    if ( hostname.startsWith('*.') ) {
        hostname = hostname.slice(2);
    }

    if ( hostname.includes('://') ) {
        try {
            hostname = new URL(hostname).hostname.toLowerCase();
        } catch {
            return;
        }
    } else {
        if ( /[\s/#?]/.test(hostname) ) { return; }
        try {
            hostname = new URL(`https://${hostname}`).hostname.toLowerCase();
        } catch {
            return;
        }
    }

    if ( hostname.startsWith('[') && hostname.endsWith(']') ) {
        hostname = hostname.slice(1, -1);
    }
    hostname = hostname.replace(/\.+$/, '');
    if ( hostname === '' || hostname === '*' ) { return; }
    return hostname;
};

const setUserFilterDisabledSites = sites => {
    disabledSites.clear();
    if ( Array.isArray(sites) === false ) { return; }
    for ( const site of sites ) {
        const hostname = normalizeHostname(site);
        if ( hostname !== undefined ) {
            disabledSites.add(hostname);
        }
    }
};

const getUserFilterDisabledSites = ( ) => {
    return Array.from(disabledSites).sort();
};

const isUserFilterSiteDisabled = hostname => {
    hostname = normalizeHostname(hostname);
    if ( hostname === undefined ) { return false; }
    for (;;) {
        if ( disabledSites.has(hostname) ) { return true; }
        const pos = hostname.indexOf('.');
        if ( pos === -1 ) { break; }
        hostname = hostname.slice(pos + 1);
    }
    return false;
};

export {
    getUserFilterDisabledSites,
    isUserFilterSiteDisabled,
    normalizeHostname,
    setUserFilterDisabledSites,
};

