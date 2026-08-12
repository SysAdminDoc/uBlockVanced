/*
    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2014-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
*/

/******************************************************************************/

const MAX_DIFF_ENTRIES = 150;

const isFilterLine = line => {
    const trimmed = line.trim();
    return trimmed !== '' && /^(?:!|#\s)/.test(trimmed) === false;
};

const ruleKeyFromLine = line => {
    // Network filter options are the part most likely to change while the
    // request pattern stays stable. Treat those as one modified rule.
    const optionPos = line.indexOf('$');
    if ( optionPos !== -1 ) {
        return line.slice(0, optionPos);
    }

    // Cosmetic rules have no option suffix, so their complete text is the
    // stable identity. This keeps selector additions as additions/removals.
    return line;
};

const linesFromContent = content => {
    if ( typeof content !== 'string' ) { return []; }
    const lines = new Map();
    for ( const line of content.split(/\r?\n/) ) {
        if ( isFilterLine(line) === false ) { continue; }
        const normalized = line.trim();
        lines.set(normalized, normalized);
    }
    return lines;
};

const cap = (items, limit) => {
    if ( items.length <= limit ) {
        return { items, truncated: false };
    }
    return {
        items: items.slice(0, limit),
        truncated: true,
    };
};

export const createFilterListDiff = (before, after, options = {}) => {
    const beforeLines = linesFromContent(before);
    const afterLines = linesFromContent(after);
    const beforeByKey = new Map();
    const afterByKey = new Map();

    for ( const line of beforeLines.values() ) {
        beforeByKey.set(ruleKeyFromLine(line), line);
    }
    for ( const line of afterLines.values() ) {
        afterByKey.set(ruleKeyFromLine(line), line);
    }

    const added = [];
    const removed = [];
    const modified = [];

    for ( const [ key, line ] of afterByKey ) {
        const previous = beforeByKey.get(key);
        if ( previous === undefined ) {
            added.push(line);
        } else if ( previous !== line ) {
            modified.push({ before: previous, after: line });
        }
    }
    for ( const [ key, line ] of beforeByKey ) {
        if ( afterByKey.has(key) === false ) {
            removed.push(line);
        }
    }

    const limit = Number.isInteger(options.limit)
        ? Math.max(1, options.limit)
        : MAX_DIFF_ENTRIES;
    const cappedAdded = cap(added, limit);
    const cappedRemoved = cap(removed, limit);
    const cappedModified = cap(modified, limit);

    return {
        added: cappedAdded.items,
        addedCount: added.length,
        removed: cappedRemoved.items,
        removedCount: removed.length,
        modified: cappedModified.items,
        modifiedCount: modified.length,
        truncated: cappedAdded.truncated ||
            cappedRemoved.truncated ||
            cappedModified.truncated,
    };
};

export const filterListDiffIsEmpty = diff => {
    if ( diff instanceof Object === false || diff === null ) { return true; }
    return (diff.addedCount || 0) === 0 &&
        (diff.removedCount || 0) === 0 &&
        (diff.modifiedCount || 0) === 0;
};
