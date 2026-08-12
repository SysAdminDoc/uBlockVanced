/*
 * uBlock Origin - a comprehensive, efficient content blocker
 * Copyright (C) 2014-present Raymond Hill
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

function classifyFilterRule(raw) {
    const entry = { raw };
    const cosmetic = raw.match(/^(.+?)(##|#@#)(.+)$/);
    if ( cosmetic ) {
        entry.type = cosmetic[2] === '#@#' ? 'exception' : 'cosmetic';
        entry.domains = cosmetic[1];
        entry.selector = cosmetic[3];
    } else if ( raw.startsWith('||') || raw.startsWith('@@') ) {
        entry.type = raw.startsWith('@@') ? 'exception' : 'network';
    } else {
        entry.type = 'other';
    }
    return entry;
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
