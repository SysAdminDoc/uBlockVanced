/*
 * uBlock Origin - a comprehensive, efficient content blocker
 * Copyright (C) 2014-present Raymond Hill
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

const COSMETIC_SEPARATOR_RE = /(#@?\??#|#@?\$\??#|#@?%#)/;
const PROCEDURAL_RE = /:([a-z][\w-]*)\s*\(/gi;

const PROCEDURAL_ALIASES = [
    [ /:matches-property\s*\(/gi, ':matches-prop(' ],
    [ /:contains\s*\(/gi, ':has-text(' ],
    [ /:nth-ancestor\s*\(/gi, ':upward(' ],
    [ /:watch-attrs\s*\(/gi, ':watch-attr(' ],
];

const UNSUPPORTED_PROCEDURALS = new Map([
    [ 'contains-own', 'AdGuard :contains-own()' ],
    [ 'debug', 'AdGuard :debug()' ],
    [ 'matches-property-regex', 'AdGuard :matches-property-regex()' ],
    [ '-abp-properties', 'ABP :-abp-properties()' ],
]);

function classifyFilterRule(raw) {
    const entry = { raw };
    const cosmetic = raw.match(new RegExp(
        `^(.*?)${COSMETIC_SEPARATOR_RE.source}(.+)$`
    ));
    if ( cosmetic ) {
        entry.separator = cosmetic[2];
        entry.type = cosmetic[2].includes('@') ? 'exception' : 'cosmetic';
        entry.domains = cosmetic[1];
        entry.selector = cosmetic[3];
    } else if ( raw.startsWith('||') || raw.startsWith('@@') ) {
        entry.type = raw.startsWith('@@') ? 'exception' : 'network';
    } else {
        entry.type = 'other';
    }
    return entry;
}

function normalizeImportedFilterLine(line, notes) {
    let normalized = line;
    for ( const [ pattern, replacement ] of PROCEDURAL_ALIASES ) {
        if ( pattern.test(normalized) === false ) { continue; }
        pattern.lastIndex = 0;
        normalized = normalized.replace(pattern, replacement);
        notes.push(`Normalized ${replacement.slice(1, -1)} compatibility alias.`);
    }

    const match = normalized.match(new RegExp(
        `^(.*?)${COSMETIC_SEPARATOR_RE.source}(.+)$`
    ));
    if ( match === null ) { return normalized; }

    for ( const operator of match[3].matchAll(PROCEDURAL_RE) ) {
        const name = operator[1].toLowerCase();
        const explanation = UNSUPPORTED_PROCEDURALS.get(name);
        if ( explanation === undefined ) { continue; }
        notes.push(`${explanation} was kept unchanged and may not compile in uBO.`);
    }
    return normalized;
}

function normalizeFilterImportText(text) {
    if ( typeof text !== 'string' ) {
        return { text: '', notes: [] };
    }
    const notes = [];
    const output = [];
    for ( const line of text.split(/\r?\n/) ) {
        const trimmed = line.trim();
        if ( trimmed === '' || trimmed.startsWith('!') ) {
            output.push(line);
            continue;
        }
        const lineNoteStart = notes.length;
        const normalized = normalizeImportedFilterLine(trimmed, notes);
        const lineNotes = notes.slice(lineNoteStart);
        for ( const note of lineNotes ) {
            output.push(`! uBlockVanced import note: ${note}`);
        }
        output.push(normalized);
    }
    return {
        text: output.join('\n'),
        notes,
    };
}

function parseFilterExportText(text) {
    const rules = [];
    const pendingNotes = [];
    for ( const line of text.split(/\r?\n/) ) {
        const trimmed = line.trim();
        if ( trimmed === '' ) { continue; }
        if ( trimmed.startsWith('!') ) {
            const note = trimmed.slice(1).trim();
            if ( note !== '' ) { pendingNotes.push(note); }
            continue;
        }
        const entry = classifyFilterRule(trimmed);
        entry.notes = pendingNotes.splice(0);
        rules.push(entry);
    }
    return {
        rules,
        unassignedNotes: pendingNotes,
    };
}

export { parseFilterExportText };
export { normalizeFilterImportText };
