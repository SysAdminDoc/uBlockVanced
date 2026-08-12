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

const STALE_FILTER_AGE = 30 * 24 * 60 * 60 * 1000;

const updateUserFilterMatchStats = function(
    currentStats,
    reports,
    now = Date.now(),
    staleAfter = STALE_FILTER_AGE
) {
    const stats = typeof currentStats === 'object' && currentStats !== null
        ? Object.assign(Object.create(null), currentStats)
        : Object.create(null);
    const staleFilters = new Set();

    if ( Array.isArray(reports) === false ) {
        return { stats, staleFilters: [] };
    }

    for ( const report of reports ) {
        if ( report instanceof Object === false ) { continue; }
        const raw = typeof report.raw === 'string' ? report.raw.trim() : '';
        if ( raw === '' || typeof report.matched !== 'boolean' ) { continue; }

        const previous = stats[raw] instanceof Object
            ? stats[raw]
            : {};
        const next = {
            firstObservedAt: previous.firstObservedAt || now,
            lastObservedAt: now,
            lastMatchedAt: previous.lastMatchedAt || 0,
            zeroSinceAt: previous.zeroSinceAt || 0,
        };

        if ( report.matched ) {
            next.lastMatchedAt = now;
            next.zeroSinceAt = 0;
        } else if ( next.zeroSinceAt === 0 ) {
            next.zeroSinceAt = now;
        }

        if (
            next.zeroSinceAt !== 0 &&
            now - next.zeroSinceAt >= staleAfter
        ) {
            next.staleAt = now;
            staleFilters.add(raw);
        }

        stats[raw] = next;
    }

    return {
        stats,
        staleFilters: Array.from(staleFilters),
    };
};

export {
    STALE_FILTER_AGE,
    updateUserFilterMatchStats,
};
