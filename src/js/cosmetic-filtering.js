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

/******************************************************************************/

import { MRUCache } from './mrucache.js';
import { StaticExtFilteringHostnameDB } from './static-ext-filtering-db.js';
import { entityFromHostname } from './uri-utils.js';
import { isUserFilterSiteDisabled } from './user-filters.js';
import logger from './logger.js';
import µb from './background.js';

/******************************************************************************/
/******************************************************************************/

const SelectorCacheEntry = class {
    constructor() {
        this.reset();
    }

    reset() {
        this.cosmetic = new Set();
        this.cosmeticHashes = new Set();
        this.disableSurveyor = false;
        this.net = new Map();
        this.accessId = SelectorCacheEntry.accessId++;
        return this;
    }

    dispose() {
        this.cosmetic = this.cosmeticHashes = this.net = null;
        if ( SelectorCacheEntry.junkyard.length < 25 ) {
            SelectorCacheEntry.junkyard.push(this);
        }
    }

    addCosmetic(details) {
        const selectors = details.selectors.join(',\n');
        if ( selectors.length !== 0 ) {
            this.cosmetic.add(selectors);
        }
        for ( const hash of details.hashes ) {
            this.cosmeticHashes.add(hash);
        }
    }

    addNet(selectors) {
        if ( typeof selectors === 'string' ) {
            this.net.set(selectors, this.accessId);
        } else {
            this.net.set(selectors.join(',\n'), this.accessId);
        }
        // Net request-derived selectors: I limit the number of cached
        // selectors, as I expect cases where the blocked network requests
        // are never the exact same URL.
        if ( this.net.size < SelectorCacheEntry.netHighWaterMark ) { return; }
        const keys = Array.from(this.net)
            .sort((a, b) => b[1] - a[1])
            .slice(SelectorCacheEntry.netLowWaterMark)
            .map(a => a[0]);
        for ( const key of keys ) {
            this.net.delete(key);
        }
    }

    addNetOne(selector, token) {
        this.net.set(selector, token);
    }

    add(details) {
        this.accessId = SelectorCacheEntry.accessId++;
        if ( details.type === 'cosmetic' ) {
            this.addCosmetic(details);
        } else {
            this.addNet(details.selectors);
        }
    }

    // https://github.com/chrisaljoudi/uBlock/issues/420
    remove(type) {
        this.accessId = SelectorCacheEntry.accessId++;
        if ( type === undefined || type === 'cosmetic' ) {
            this.cosmetic.clear();
        }
        if ( type === undefined || type === 'net' ) {
            this.net.clear();
        }
    }

    retrieveToArray(iterator, out) {
        for ( const selector of iterator ) {
            out.push(selector);
        }
    }

    retrieveToSet(iterator, out) {
        for ( const selector of iterator ) {
            out.add(selector);
        }
    }

    retrieveNet(out) {
        this.accessId = SelectorCacheEntry.accessId++;
        if ( this.net.size === 0 ) { return false; }
        this.retrieveToArray(this.net.keys(), out);
        return true;
    }

    retrieveCosmetic(selectors, hashes) {
        this.accessId = SelectorCacheEntry.accessId++;
        if ( this.cosmetic.size === 0 ) { return false; }
        this.retrieveToSet(this.cosmetic, selectors);
        this.retrieveToArray(this.cosmeticHashes, hashes);
        return true;
    }

    static factory() {
        const entry = SelectorCacheEntry.junkyard.pop();
        return entry
            ? entry.reset()
            : new SelectorCacheEntry();
    }
};

SelectorCacheEntry.accessId = 1;
SelectorCacheEntry.netLowWaterMark = 20;
SelectorCacheEntry.netHighWaterMark = 30;
SelectorCacheEntry.junkyard = [];

/******************************************************************************/
/******************************************************************************/

// http://www.cse.yorku.ca/~oz/hash.html#djb2
//   Must mirror content script surveyor's version

const hashFromStr = (type, s) => {
    const len = s.length;
    const step = len + 7 >>> 3;
    let hash = (type << 5) + type ^ len;
    for ( let i = 0; i < len; i += step ) {
        hash = (hash << 5) + hash ^ s.charCodeAt(i);
    }
    return hash & 0xFFFFFF;
};

// https://github.com/gorhill/uBlock/issues/1668
//   The key must be literal: unescape escaped CSS before extracting key.
//   It's an uncommon case, so it's best to unescape only when needed.

const keyFromSelector = selector => {
    let matches = reSimplestSelector.exec(selector);
    if ( matches !== null ) { return matches[0]; }
    let key = '';
    matches = rePlainSelector.exec(selector);
    if ( matches !== null ) {
        key = matches[0];
    } else {
        matches = rePlainSelectorEx.exec(selector);
        if ( matches === null ) { return; }
        key = matches[1] || matches[2];
    }
    if ( selector.includes(',') ) { return; }
    if ( key.includes('\\') === false ) { return key; }
    matches = rePlainSelectorEscaped.exec(selector);
    if ( matches === null ) { return; }
    key = '';
    const escaped = matches[0];
    let beg = 0;
    reEscapeSequence.lastIndex = 0;
    for (;;) {
        matches = reEscapeSequence.exec(escaped);
        if ( matches === null ) {
            return key + escaped.slice(beg);
        }
        key += escaped.slice(beg, matches.index);
        beg = reEscapeSequence.lastIndex;
        if ( matches[1].length === 1 ) {
            key += matches[1];
        } else {
            key += String.fromCharCode(parseInt(matches[1], 16));
        }
    }
};

const reSimplestSelector = /^[#.][\w-]+$/;
const rePlainSelector = /^[#.][\w\\-]+/;
const rePlainSelectorEx = /^[^#.[(]+([#.][\w-]+)|([#.][\w-]+)$/;
const rePlainSelectorEscaped = /^[#.](?:\\[0-9A-Fa-f]+ |\\.|\w|-)+/;
const reEscapeSequence = /\\([0-9A-Fa-f]+ |.)/g;

/******************************************************************************/
/******************************************************************************/

// Cosmetic filter family tree:
//
// Generic
//    Low generic simple: class or id only
//    Low generic complex: class or id + extra stuff after
//    High generic:
//       High-low generic: [alt="..."],[title="..."]
//       High-medium generic: [href^="..."]
//       High-high generic: everything else
// Specific
//    Specific hostname
//    Specific entity
// Generic filters can only be enforced once the main document is loaded.
// Specific filers can be enforced before the main document is loaded.

const createHighlyGeneric = ( ) => ({
    simple: {
        canonical: 'highGenericHideSimple',
        dict: new Set(),
        str: '',
        mru: new MRUCache(16)
    },
    complex: {
        canonical: 'highGenericHideComplex',
        dict: new Set(),
        str: '',
        mru: new MRUCache(16)
    },
});

const CosmeticFilteringEngine = function() {
    this.reSimpleHighGeneric = /^(?:[a-z]*\[[^\]]+\]|\S+)$/;

    this.selectorCache = new Map();
    this.selectorCachePruneDelay = 10; // 10 minutes
    this.selectorCacheCountMin = 40;
    this.selectorCacheCountMax = 50;
    this.selectorCacheTimer = vAPI.defer.create(( ) => {
        this.pruneSelectorCacheAsync();
    });

    // specific filters
    this.specificFilters = new StaticExtFilteringHostnameDB();
    this.userSpecificFilters = new StaticExtFilteringHostnameDB();

    // low generic cosmetic filters: map of hash => stringified selector list
    this.lowlyGeneric = new Map();
    this.userLowlyGeneric = new Map();

    // highly generic selectors sets
    this.highlyGeneric = createHighlyGeneric();
    this.userHighlyGeneric = createHighlyGeneric();

    // Original user filter text is retained so content-script match reports
    // can be associated with the exact line which produced a selector.
    this.userSpecificFilterMetadata = new Map();
    this.userLowlyGenericMetadata = new Map();
    this.userHighlyGenericMetadata = new Map();
    this.reset();
};

/******************************************************************************/

// Reset all, thus reducing to a minimum memory footprint of the context.

CosmeticFilteringEngine.prototype.reset = function() {
    this.frozen = false;
    this.acceptedCount = 0;
    this.discardedCount = 0;
    this.duplicateBuster = new Set();
    this.userDuplicateBuster = new Set();

    this.selectorCache.clear();
    this.selectorCacheTimer.off();

    // hostname, entity-based filters
    this.specificFilters.clear();
    this.userSpecificFilters.clear();

    // low generic cosmetic filters
    this.lowlyGeneric.clear();
    this.userLowlyGeneric.clear();

    // highly generic selectors sets
    this.highlyGeneric.simple.dict.clear();
    this.highlyGeneric.simple.str = '';
    this.highlyGeneric.simple.mru.reset();
    this.highlyGeneric.complex.dict.clear();
    this.highlyGeneric.complex.str = '';
    this.highlyGeneric.complex.mru.reset();
    this.userHighlyGeneric.simple.dict.clear();
    this.userHighlyGeneric.simple.str = '';
    this.userHighlyGeneric.simple.mru.reset();
    this.userHighlyGeneric.complex.dict.clear();
    this.userHighlyGeneric.complex.str = '';
    this.userHighlyGeneric.complex.mru.reset();

    this.userSpecificFilterMetadata.clear();
    this.userLowlyGenericMetadata.clear();
    this.userHighlyGenericMetadata.clear();

    this.selfieVersion = 4;
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.freeze = function() {
    this.duplicateBuster.clear();
    this.userDuplicateBuster.clear();
    this.specificFilters.collectGarbage();
    this.userSpecificFilters.collectGarbage();

    this.highlyGeneric.simple.str = Array.from(this.highlyGeneric.simple.dict).join(',\n');
    this.highlyGeneric.simple.mru.reset();
    this.highlyGeneric.complex.str = Array.from(this.highlyGeneric.complex.dict).join(',\n');
    this.highlyGeneric.complex.mru.reset();
    this.userHighlyGeneric.simple.str = Array.from(
        this.userHighlyGeneric.simple.dict
    ).join(',\n');
    this.userHighlyGeneric.simple.mru.reset();
    this.userHighlyGeneric.complex.str = Array.from(
        this.userHighlyGeneric.complex.dict
    ).join(',\n');
    this.userHighlyGeneric.complex.mru.reset();

    this.frozen = true;
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.compile = function(parser, writer) {
    if ( parser.hasOptions() === false ) {
        this.compileGenericSelector(parser, writer);
        return true;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/151
    //   Negated hostname means the filter applies to all non-negated hostnames
    //   of same filter OR globally if there is no non-negated hostnames.
    let applyGlobally = true;
    for ( const { hn, not, bad } of parser.getExtFilterDomainIterator() ) {
        if ( bad ) { continue; }
        if ( not === false ) {
            applyGlobally = false;
        }
        this.compileSpecificSelector(parser, hn, not, writer);
    }
    if ( applyGlobally ) {
        this.compileGenericSelector(parser, writer);
    }

    return true;
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.compileGenericSelector = function(parser, writer) {
    if ( parser.isException() ) {
        this.compileGenericUnhideSelector(parser, writer);
    } else {
        this.compileGenericHideSelector(parser, writer);
    }
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.compileGenericHideSelector = function(
    parser,
    writer
) {
    const { raw, compiled } = parser.result;
    if ( compiled === undefined ) {
        const who = writer.properties.get('name') || '?';
        logger.writeOne({
            realm: 'message',
            type: 'error',
            text: `Invalid generic cosmetic filter in ${who}: ${raw}`
        });
        return;
    }

    writer.select('COSMETIC_FILTERS:GENERIC');

    // https://github.com/uBlockOrigin/uBlock-issues/issues/131
    //   Support generic procedural filters as per advanced settings.
    if ( compiled.charCodeAt(0) === 0x7B /* '{' */ ) {
        if ( µb.hiddenSettings.allowGenericProceduralFilters === true ) {
            return this.compileSpecificSelector(parser, '', false, writer);
        }
        const who = writer.properties.get('name') || '?';
        logger.writeOne({
            realm: 'message',
            type: 'error',
            text: `Invalid generic cosmetic filter in ${who}: ##${raw}`
        });
        return;
    }

    const key = keyFromSelector(compiled);
    if ( key !== undefined ) {
        const args = [
            0,
            hashFromStr(key.charCodeAt(0), key.slice(1)),
            compiled,
        ];
        if ( writer.properties.get('userFilters') === true ) {
            args.push(parser.raw);
        }
        writer.push(args);
        return;
    }

    // Pass this point, we are dealing with highly-generic cosmetic filters.
    //
    // For efficiency purpose, we will distinguish between simple and complex
    // selectors.

    if ( this.reSimpleHighGeneric.test(compiled) ) {
        const args = [ 4 /* simple */, compiled ];
        if ( writer.properties.get('userFilters') === true ) {
            args.push(parser.raw);
        }
        writer.push(args);
    } else {
        const args = [ 5 /* complex */, compiled ];
        if ( writer.properties.get('userFilters') === true ) {
            args.push(parser.raw);
        }
        writer.push(args);
    }
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.compileGenericUnhideSelector = function(
    parser,
    writer
) {
    // Procedural cosmetic filters are acceptable as generic exception filters.
    const { raw, compiled } = parser.result;
    if ( compiled === undefined ) {
        const who = writer.properties.get('name') || '?';
        logger.writeOne({
            realm: 'message',
            type: 'error',
            text: `Invalid cosmetic filter in ${who}: #@#${raw}`
        });
        return;
    }

    writer.select('COSMETIC_FILTERS:SPECIFIC');

    // https://github.com/chrisaljoudi/uBlock/issues/497
    //   All generic exception filters are stored as hostname-based filter
    //   whereas the hostname is the empty string (which matches all
    //   hostnames). No distinction is made between declarative and
    //   procedural selectors, since they really exist only to cancel
    //   out other cosmetic filters.
    const args = [ 8, '', `-${compiled}` ];
    if ( writer.properties.get('userFilters') === true ) {
        args.push(parser.raw);
    }
    writer.push(args);
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.compileSpecificSelector = function(
    parser,
    hostname,
    not,
    writer
) {
    const { raw, compiled, exception } = parser.result;
    if ( compiled === undefined ) {
        const who = writer.properties.get('name') || '?';
        logger.writeOne({
            realm: 'message',
            type: 'error',
            text: `Invalid cosmetic filter in ${who}: ##${raw}`
        });
        return;
    }

    writer.select('COSMETIC_FILTERS:SPECIFIC');
    const prefix = ((exception ? 1 : 0) ^ (not ? 1 : 0)) ? '-' : '+';
    const args = [ 8, hostname, `${prefix}${compiled}` ];
    if ( writer.properties.get('userFilters') === true ) {
        args.push(parser.raw);
    }
    writer.push(args);
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.fromCompiledContent = function(
    reader,
    options = {}
) {
    if ( options.skipCosmetic ) {
        this.skipCompiledContent(reader, 'SPECIFIC');
        this.skipCompiledContent(reader, 'GENERIC');
        return;
    }

    const isUserFilter = options.userFilters === true;
    const duplicateBuster = isUserFilter
        ? this.userDuplicateBuster
        : this.duplicateBuster;
    const specificFilters = isUserFilter
        ? this.userSpecificFilters
        : this.specificFilters;
    const highlyGeneric = isUserFilter
        ? this.userHighlyGeneric
        : this.highlyGeneric;
    const lowlyGeneric = isUserFilter
        ? this.userLowlyGeneric
        : this.lowlyGeneric;

    const addMetadata = (map, key, raw) => {
        if ( isUserFilter === false || typeof raw !== 'string' ) { return; }
        const value = raw.trim();
        if ( value === '' ) { return; }
        let values = map.get(key);
        if ( values === undefined ) {
            values = new Set();
            map.set(key, values);
        }
        values.add(value);
    };

    // Specific cosmetic filter section
    reader.select('COSMETIC_FILTERS:SPECIFIC');
    while ( reader.next() ) {
        this.acceptedCount += 1;
        const fingerprint = reader.fingerprint();
        if ( duplicateBuster.has(fingerprint) ) {
            this.discardedCount += 1;
            continue;
        }
        duplicateBuster.add(fingerprint);
        const args = reader.args();
        switch ( args[0] ) {
        // hash,  example.com, .promoted-tweet
        // hash,  example.*, .promoted-tweet
        //
        // https://github.com/uBlockOrigin/uBlock-issues/issues/803
        //   Handle specific filters meant to apply everywhere, i.e. selectors
        //   not to be injected conditionally through the DOM surveyor.
        //   hash,  *, .promoted-tweet
        case 8: {
            if ( args[1] === '*' && args[2].charCodeAt(0) === 0x2D /* + */ ) {
                const selector = args[2].slice(1);
                if ( selector.charCodeAt(0) !== 0x7B /* { */ ) {
                    if ( this.reSimpleHighGeneric.test(selector) ) {
                        highlyGeneric.simple.dict.add(selector);
                    } else {
                        highlyGeneric.complex.dict.add(selector);
                    }
                    addMetadata(
                        this.userHighlyGenericMetadata,
                        selector,
                        args[3]
                    );
                    break;
                }
            }
            specificFilters.store(args[1], args[2]);
            addMetadata(
                this.userSpecificFilterMetadata,
                `${args[1]}\x00${args[2]}`,
                args[3]
            );
            break;
        }
        default:
            this.discardedCount += 1;
            break;
        }
    }

    if ( options.skipGenericCosmetic ) {
        this.skipCompiledContent(reader, 'GENERIC');
        return;
    }

    // Generic cosmetic filter section
    reader.select('COSMETIC_FILTERS:GENERIC');
    while ( reader.next() ) {
        this.acceptedCount += 1;
        const fingerprint = reader.fingerprint();
        if ( duplicateBuster.has(fingerprint) ) {
            this.discardedCount += 1;
            continue;
        }
        duplicateBuster.add(fingerprint);
        const args = reader.args();
        switch ( args[0] ) {
        // low generic
        case 0: {
            if ( lowlyGeneric.has(args[1]) ) {
                const selector = lowlyGeneric.get(args[1]);
                lowlyGeneric.set(args[1], `${selector},\n${args[2]}`);
            } else {
                lowlyGeneric.set(args[1], args[2]);
            }
            addMetadata(
                this.userLowlyGenericMetadata,
                `${args[1]}\x00${args[2]}`,
                args[3]
            );
            break;
        }
        // High-high generic hide/simple selectors
        // div[id^="allo"]
        case 4:
            highlyGeneric.simple.dict.add(args[1]);
            addMetadata(this.userHighlyGenericMetadata, args[1], args[2]);
            break;
        // High-high generic hide/complex selectors
        // div[id^="allo"] > span
        case 5:
            highlyGeneric.complex.dict.add(args[1]);
            addMetadata(this.userHighlyGenericMetadata, args[1], args[2]);
            break;
        default:
            this.discardedCount += 1;
            break;
        }
    }
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.skipCompiledContent = function(reader, sectionId) {
    reader.select(`COSMETIC_FILTERS:${sectionId}`);
    while ( reader.next() ) {
        this.acceptedCount += 1;
        this.discardedCount += 1;
    }
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.toSelfie = function() {
    return {
        version: this.selfieVersion,
        acceptedCount: this.acceptedCount,
        discardedCount: this.discardedCount,
        specificFilters: this.specificFilters.toSelfie(),
        userSpecificFilters: this.userSpecificFilters.toSelfie(),
        lowlyGeneric: this.lowlyGeneric,
        userLowlyGeneric: this.userLowlyGeneric,
        highSimpleGenericHideDict: this.highlyGeneric.simple.dict,
        highSimpleGenericHideStr: this.highlyGeneric.simple.str,
        highComplexGenericHideDict: this.highlyGeneric.complex.dict,
        highComplexGenericHideStr: this.highlyGeneric.complex.str,
        userHighSimpleGenericHideDict: this.userHighlyGeneric.simple.dict,
        userHighSimpleGenericHideStr: this.userHighlyGeneric.simple.str,
        userHighComplexGenericHideDict: this.userHighlyGeneric.complex.dict,
        userHighComplexGenericHideStr: this.userHighlyGeneric.complex.str,
        userSpecificFilterMetadata: Array.from(
            this.userSpecificFilterMetadata,
            ([key, values]) => [ key, Array.from(values) ]
        ),
        userLowlyGenericMetadata: Array.from(
            this.userLowlyGenericMetadata,
            ([key, values]) => [ key, Array.from(values) ]
        ),
        userHighlyGenericMetadata: Array.from(
            this.userHighlyGenericMetadata,
            ([key, values]) => [ key, Array.from(values) ]
        ),
    };
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.fromSelfie = function(selfie) {
    if ( selfie.version !== this.selfieVersion ) {
        throw new TypeError('Bad selfie');
    }
    this.acceptedCount = selfie.acceptedCount;
    this.discardedCount = selfie.discardedCount;
    this.specificFilters.fromSelfie(selfie.specificFilters);
    this.userSpecificFilters.fromSelfie(selfie.userSpecificFilters);
    this.lowlyGeneric = selfie.lowlyGeneric;
    this.userLowlyGeneric = selfie.userLowlyGeneric;
    this.highlyGeneric.simple.dict = selfie.highSimpleGenericHideDict;
    this.highlyGeneric.simple.str = selfie.highSimpleGenericHideStr;
    this.highlyGeneric.complex.dict = selfie.highComplexGenericHideDict;
    this.highlyGeneric.complex.str = selfie.highComplexGenericHideStr;
    this.userHighlyGeneric.simple.dict = selfie.userHighSimpleGenericHideDict;
    this.userHighlyGeneric.simple.str = selfie.userHighSimpleGenericHideStr;
    this.userHighlyGeneric.complex.dict = selfie.userHighComplexGenericHideDict;
    this.userHighlyGeneric.complex.str = selfie.userHighComplexGenericHideStr;
    this.userSpecificFilterMetadata = new Map(
        (selfie.userSpecificFilterMetadata || []).map(([key, values]) => [
            key,
            new Set(values),
        ])
    );
    this.userLowlyGenericMetadata = new Map(
        (selfie.userLowlyGenericMetadata || []).map(([key, values]) => [
            key,
            new Set(values),
        ])
    );
    this.userHighlyGenericMetadata = new Map(
        (selfie.userHighlyGenericMetadata || []).map(([key, values]) => [
            key,
            new Set(values),
        ])
    );
    this.frozen = true;
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.addToSelectorCache = function(details) {
    const hostname = details.hostname;
    if ( typeof hostname !== 'string' || hostname === '' ) { return; }
    const selectors = details.selectors;
    if ( Array.isArray(selectors) === false ) { return; }
    let entry = this.selectorCache.get(hostname);
    if ( entry === undefined ) {
        entry = SelectorCacheEntry.factory();
        this.selectorCache.set(hostname, entry);
        if ( this.selectorCache.size > this.selectorCacheCountMax ) {
            this.selectorCacheTimer.on({ min: this.selectorCachePruneDelay });
        }
    }
    entry.add(details);
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.removeFromSelectorCache = function(
    targetHostname = '*',
    type = undefined
) {
    const targetHostnameLength = targetHostname.length;
    for ( const [ hostname, item ] of this.selectorCache ) {
        if ( targetHostname !== '*' ) {
            if ( hostname.endsWith(targetHostname) === false ) { continue; }
            if ( hostname.length !== targetHostnameLength ) {
                if ( hostname.at(-1) !== '.' ) { continue; }
            }
        }
        item.remove(type);
    }
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.pruneSelectorCacheAsync = function() {
    if ( this.selectorCache.size <= this.selectorCacheCountMax ) { return; }
    const cache = this.selectorCache;
    const hostnames = Array.from(cache.keys())
        .sort((a, b) => cache.get(b).accessId - cache.get(a).accessId)
        .slice(this.selectorCacheCountMin);
    for ( const hn of hostnames ) {
        cache.get(hn).dispose();
        cache.delete(hn);
    }
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.disableSurveyor = function(details) {
    const hostname = details.hostname;
    if ( typeof hostname !== 'string' || hostname === '' ) { return; }
    const cacheEntry = this.selectorCache.get(hostname);
    if ( cacheEntry === undefined ) { return; }
    cacheEntry.disableSurveyor = true;
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.cssRuleFromProcedural = function(pfilter) {
    if ( pfilter.cssable !== true ) { return; }
    const { tasks, action } = pfilter;
    let mq, selector;
    if ( Array.isArray(tasks) ) {
        if ( tasks[0][0] !== 'matches-media' ) { return; }
        mq = tasks[0][1];
        if ( tasks.length > 2 ) { return; }
        if ( tasks.length === 2 ) {
            if ( tasks[1][0] !== 'spath' ) { return; }
            selector = tasks[1][1];
        }
    }
    let style;
    if ( Array.isArray(action) ) {
        if ( action[0] !== 'style' ) { return; }
        selector = selector || pfilter.selector;
        style = action[1];
    }
    if ( mq === undefined && style === undefined && selector === undefined ) { return; }
    if ( mq === undefined ) {
        return `${selector}\n{${style}}`;
    }
    if ( style === undefined ) {
        return `@media ${mq} {\n${selector}\n{display:none!important;}\n}`;
    }
    return `@media ${mq} {\n${selector}\n{${style}}\n}`;
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.retrieveGenericSelectors = function(request) {
    if ( Array.isArray(request.hashes) === false ) { return; }
    if ( request.hashes.length === 0 ) { return; }

    const includeUserFilters =
        isUserFilterSiteDisabled(request.hostname) === false;
    if (
        this.lowlyGeneric.size === 0 &&
        (includeUserFilters === false || this.userLowlyGeneric.size === 0)
    ) {
        return;
    }

    const selectorsSet = new Set();
    const userFilterSelectors = new Map();
    const hashes = [];
    const safeOnly = request.safeOnly === true;
    for ( const hash of request.hashes ) {
        let found = false;
        const addBucket = (bucket, isUserFilter = false) => {
            if ( bucket === undefined ) { return; }
            found = true;
            for ( const selector of bucket.split(',\n') ) {
                if ( safeOnly && selector === keyFromSelector(selector) ) { continue; }
                selectorsSet.add(selector);
                if ( isUserFilter ) {
                    const raws = this.userLowlyGenericMetadata.get(
                        `${hash}\x00${selector}`
                    );
                    if ( raws === undefined ) { continue; }
                    for ( const raw of raws ) {
                        userFilterSelectors.set(
                            `${raw}\x00${selector}`,
                            { raw, selector }
                        );
                    }
                }
            }
        };
        addBucket(this.lowlyGeneric.get(hash));
        if ( includeUserFilters ) {
            addBucket(this.userLowlyGeneric.get(hash), true);
        }
        if ( found ) { hashes.push(hash); }
    }

    // Apply exceptions: it is the responsibility of the caller to provide
    // the exceptions to be applied.
    const excepted = [];
    if ( selectorsSet.size !== 0 && Array.isArray(request.exceptions) ) {
        for ( const exception of request.exceptions ) {
            if ( selectorsSet.delete(exception) ) {
                excepted.push(exception);
            }
        }
    }

    for ( const [key, details] of userFilterSelectors ) {
        if ( selectorsSet.has(details.selector) === false ) {
            userFilterSelectors.delete(key);
        }
    }

    if ( selectorsSet.size === 0 && excepted.length === 0 ) { return; }

    const out = {
        injectedCSS: '',
        excepted,
        userFilterSelectors: Array.from(userFilterSelectors.values()),
    };
    const selectors = Array.from(selectorsSet);

    if ( typeof request.hostname === 'string' && request.hostname !== '' ) {
        this.addToSelectorCache({
            hostname: request.hostname,
            selectors,
            hashes,
            type: 'cosmetic',
        });
    }

    if ( selectors.length === 0 ) { return out; }

    out.injectedCSS = `${selectors.join(',\n')}\n{display:none!important;}`;
    if ( request.cspCompatibleMode !== true ) {
        vAPI.tabs.insertCSS(request.tabId, {
            code: out.injectedCSS,
            frameId: request.frameId,
            matchAboutBlank: true,
            runAt: 'document_start',
        });
    }

    return out;
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.retrieveSpecificSelectors = function(
    request,
    options
) {
    const hostname = request.hostname;
    const includeUserFilters = isUserFilterSiteDisabled(hostname) === false;
    const cacheEntry = this.selectorCache.get(hostname);

    // https://github.com/chrisaljoudi/uBlock/issues/587
    // out.ready will tell the content script the cosmetic filtering engine is
    // up and ready.

    // https://github.com/chrisaljoudi/uBlock/issues/497
    // Generic exception filters are to be applied on all pages.

    const out = {
        ready: this.frozen,
        hostname: hostname,
        domain: request.domain,
        exceptionFilters: [],
        exceptedFilters: [],
        proceduralFilters: [],
        convertedProceduralFilters: [],
        disableSurveyor: this.lowlyGeneric.size === 0 && (
            includeUserFilters === false || this.userLowlyGeneric.size === 0
        ),
    };
    const injectedCSS = [];
    const exceptionSet = new Set();
    const userFilterSelectors = new Map();
    const addUserFilterSelectors = (raws, selector) => {
        if ( raws === undefined || selector.charCodeAt(0) === 0x7B ) {
            return;
        }
        for ( const raw of raws ) {
            userFilterSelectors.set(
                `${raw}\x00${selector}`,
                { raw, selector }
            );
        }
    };
    const userSpecificFilterRaws = new Map();
    const noteUserSpecificFilter = (target, value) => {
        const raws = this.userSpecificFilterMetadata.get(
            `${target}\x00${value}`
        );
        if ( raws === undefined ) { return; }
        let values = userSpecificFilterRaws.get(value);
        if ( values === undefined ) {
            values = new Set();
            userSpecificFilterRaws.set(value, values);
        }
        for ( const raw of raws ) {
            values.add(raw);
        }
    };

    if ( options.noSpecificCosmeticFiltering !== true ) {
        // Cached cosmetic filters: these are always declarative.
        const specificSet = new Set();
        if ( cacheEntry !== undefined ) {
            cacheEntry.retrieveCosmetic(specificSet, out.genericCosmeticHashes = []);
            if ( cacheEntry.disableSurveyor ) {
                out.disableSurveyor = true;
            }
        }

        const allSet = new Set();
        // Retrieve filters with a non-empty hostname
        this.specificFilters.retrieveSpecifics(allSet, hostname);
        // Retrieve filters with a entity-based hostname value
        const entity = entityFromHostname(hostname, request.domain);
        this.specificFilters.retrieveSpecifics(allSet, entity);
        // Retrieve filters with a regex-based hostname value
        this.specificFilters.retrieveSpecificsByRegex(allSet, hostname, request.url);
        // Retrieve filters with an empty hostname
        this.specificFilters.retrieveGenerics(allSet);
        if ( includeUserFilters ) {
            this.userSpecificFilters.retrieveSpecifics(
                allSet,
                hostname,
                noteUserSpecificFilter
            );
            this.userSpecificFilters.retrieveSpecifics(
                allSet,
                entity,
                noteUserSpecificFilter
            );
            this.userSpecificFilters.retrieveSpecificsByRegex(
                allSet,
                hostname,
                request.url,
                noteUserSpecificFilter
            );
            this.userSpecificFilters.retrieveGenerics(
                allSet,
                noteUserSpecificFilter
            );
        }

        // Split filters in different groups
        const proceduralSet = new Set();
        for ( const s of allSet ) {
            const selector = s.slice(1);
            if ( s.charCodeAt(0) === 0x2D /* - */ ) {
                exceptionSet.add(selector);
            } else if ( selector.charCodeAt(0) === 0x7B /* { */ ) {
                proceduralSet.add(selector);
            } else {
                specificSet.add(selector);
            }
        }

        // Apply exceptions to specific filterset
        if ( exceptionSet.size !== 0 ) {
            out.exceptionFilters = Array.from(exceptionSet);
            for ( const selector of specificSet ) {
                if ( exceptionSet.has(selector) === false ) { continue; }
                specificSet.delete(selector);
                out.exceptedFilters.push(selector);
            }
        }

        for ( const selector of specificSet ) {
            addUserFilterSelectors(
                userSpecificFilterRaws.get(`+${selector}`),
                selector
            );
        }

        if ( includeUserFilters ) {
            for ( const [hash, bucket] of this.userLowlyGeneric ) {
                for ( const selector of bucket.split(',\n') ) {
                    if ( exceptionSet.has(selector) ) { continue; }
                    addUserFilterSelectors(
                        this.userLowlyGenericMetadata.get(
                            `${hash}\x00${selector}`
                        ),
                        selector
                    );
                }
            }
        }

        if ( specificSet.size !== 0 ) {
            injectedCSS.push(
                `${Array.from(specificSet).join(',\n')}\n{display:none!important;}`
            );
        }

        // Apply exceptions to procedural filterset.
        // Also, some procedural filters are really declarative cosmetic
        // filters, so we extract and inject them immediately.
        if ( proceduralSet.size !== 0 ) {
            for ( const json of proceduralSet ) {
                if ( exceptionSet.has(json) ) {
                    proceduralSet.delete(json);
                    out.exceptedFilters.push(json);
                    continue;
                }
                const pfilter = JSON.parse(json);
                if ( exceptionSet.has(pfilter.raw) ) {
                    proceduralSet.delete(json);
                    out.exceptedFilters.push(pfilter.raw);
                    continue;
                }
                const cssRule = this.cssRuleFromProcedural(pfilter);
                if ( cssRule === undefined ) { continue; }
                injectedCSS.push(cssRule);
                proceduralSet.delete(json);
                out.convertedProceduralFilters.push(json);
            }
            out.proceduralFilters.push(...proceduralSet);
        }
    }

    // Highly generic cosmetic filters: sent once along with specific ones.
    // A most-recent-used cache is used to skip computing the resulting set
    //   of high generics for a given set of exceptions.
    // The resulting set of high generics is stored as a string, ready to
    //   be used as-is by the content script. The string is stored
    //   indirectly in the mru cache: this is to prevent duplication of the
    //   string in memory, which I have observed occurs when the string is
    //   stored directly as a value in a Map.
    if ( options.noGenericCosmeticFiltering !== true ) {
        const exceptionSetHash = `${includeUserFilters ? 1 : 0}:` +
            out.exceptionFilters.join();
        for ( const key in this.highlyGeneric ) {
            const entry = this.highlyGeneric[key];
            const userEntry = includeUserFilters
                ? this.userHighlyGeneric[key]
                : undefined;
            let str = entry.mru.lookup(exceptionSetHash);
            if ( str === undefined ) {
                const genericSet = new Set(entry.dict);
                if ( userEntry !== undefined ) {
                    for ( const selector of userEntry.dict ) {
                        genericSet.add(selector);
                    }
                }
                str = {
                    s: Array.from(genericSet).join(',\n'),
                    excepted: [],
                };
                for ( const exception of exceptionSet ) {
                    if ( genericSet.delete(exception) ) {
                        str.excepted.push(exception);
                    }
                }
                str.s = Array.from(genericSet).join(',\n');
                entry.mru.add(exceptionSetHash, str);
            }
            if ( str.excepted.length !== 0 ) {
                out.exceptedFilters.push(...str.excepted);
            }
            if ( str.s.length !== 0 ) {
                injectedCSS.push(`${str.s}\n{display:none!important;}`);
            }
            if ( userEntry !== undefined ) {
                const activeSelectors = new Set(
                    str.s.length === 0 ? [] : str.s.split(',\n')
                );
                for ( const selector of userEntry.dict ) {
                    if ( activeSelectors.has(selector) === false ) { continue; }
                    addUserFilterSelectors(
                        this.userHighlyGenericMetadata.get(selector),
                        selector
                    );
                }
            }
        }
    }

    out.userFilterSelectors = Array.from(userFilterSelectors.values());

    const details = {
        code: '',
        frameId: request.frameId,
        matchAboutBlank: true,
        runAt: 'document_start',
    };

    // Inject all declarative-based filters as a single stylesheet.
    if ( injectedCSS.length !== 0 ) {
        out.injectedCSS = injectedCSS.join('\n\n');
        details.code = out.injectedCSS;
        if (
            request.tabId !== undefined &&
            options.dontInject !== true &&
            options.cspCompatibleMode !== true
        ) {
            vAPI.tabs.insertCSS(request.tabId, details);
        }
    }

    // CSS selectors for collapsible blocked elements
    if ( cacheEntry ) {
        const networkFilters = [];
        if ( cacheEntry.retrieveNet(networkFilters) ) {
            const networkCSS = `${networkFilters.join('\n')}\n{display:none!important;}`;
            details.code = networkCSS;
            if ( options.cspCompatibleMode === true ) {
                out.networkCSS = networkCSS;
            }
            if (
                request.tabId !== undefined &&
                options.dontInject !== true &&
                options.cspCompatibleMode !== true
            ) {
                vAPI.tabs.insertCSS(request.tabId, details);
            }
        }
    }

    return out;
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.getFilterCount = function() {
    return this.acceptedCount - this.discardedCount;
};

/******************************************************************************/

CosmeticFilteringEngine.prototype.dump = function() {
    const lowlyGenerics = [];
    for ( const selectors of this.lowlyGeneric.values() ) {
        lowlyGenerics.push(...selectors.split(',\n'));
    }
    lowlyGenerics.sort();
    const highlyGenerics = Array.from(this.highlyGeneric.simple.dict).sort();
    highlyGenerics.push(...Array.from(this.highlyGeneric.complex.dict).sort());
    return [
        'Cosmetic Filtering Engine internals:',
        `specific: ${this.specificFilters.size}`,
        `generic: ${lowlyGenerics.length + highlyGenerics.length}`,
        `+ lowly generic: ${lowlyGenerics.length}`,
        ...lowlyGenerics.map(a => `  ${a}`),
        `+ highly generic: ${highlyGenerics.length}`,
        ...highlyGenerics.map(a => `  ${a}`),
    ].join('\n');
};

/******************************************************************************/

const cosmeticFilteringEngine = new CosmeticFilteringEngine();

export default cosmeticFilteringEngine;

/******************************************************************************/
