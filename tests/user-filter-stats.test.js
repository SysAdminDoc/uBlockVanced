import assert from 'node:assert/strict';
import test from 'node:test';

import {
    STALE_FILTER_AGE,
    updateUserFilterMatchStats,
} from '../src/js/user-filter-stats.js';

test('user filter match stats reset the stale clock after a match', () => {
    const start = 1000;
    const first = updateUserFilterMatchStats(
        {},
        [ { raw: 'example.com##.ad', matched: false } ],
        start
    );

    assert.deepEqual(first.staleFilters, []);
    assert.equal(first.stats['example.com##.ad'].zeroSinceAt, start);

    const matched = updateUserFilterMatchStats(
        first.stats,
        [ { raw: 'example.com##.ad', matched: true } ],
        start + STALE_FILTER_AGE
    );
    assert.deepEqual(matched.staleFilters, []);
    assert.equal(matched.stats['example.com##.ad'].zeroSinceAt, 0);
    assert.equal(
        matched.stats['example.com##.ad'].lastMatchedAt,
        start + STALE_FILTER_AGE
    );
});

test('user filter match stats mark a rule stale after 30 zero-match days', () => {
    const start = 1000;
    const first = updateUserFilterMatchStats(
        {},
        [ { raw: '##.old-ad', matched: false } ],
        start
    );
    const stale = updateUserFilterMatchStats(
        first.stats,
        [ { raw: '##.old-ad', matched: false } ],
        start + STALE_FILTER_AGE
    );

    assert.deepEqual(stale.staleFilters, [ '##.old-ad' ]);
    assert.equal(stale.stats['##.old-ad'].staleAt, start + STALE_FILTER_AGE);
});

