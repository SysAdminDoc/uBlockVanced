import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createFilterListDiff,
    filterListDiffIsEmpty,
} from '../src/js/filter-list-diff.js';

test('filter list diff ignores comments and blank lines', () => {
    const diff = createFilterListDiff(
        '! old header\n\n||old.example^\n# old note\n',
        '! new header\n||new.example^\n'
    );

    assert.deepEqual(diff.added, [ '||new.example^' ]);
    assert.deepEqual(diff.removed, [ '||old.example^' ]);
    assert.deepEqual(diff.modified, []);
    assert.equal(diff.addedCount, 1);
    assert.equal(diff.removedCount, 1);
    assert.equal(filterListDiffIsEmpty(diff), false);
});

test('filter options changing on the same pattern are reported as modified', () => {
    const diff = createFilterListDiff(
        '||example.com^$script\nexample.com##.old-ad\n',
        '||example.com^$image\nexample.com##.new-ad\n'
    );

    assert.deepEqual(diff.modified, [
        {
            before: '||example.com^$script',
            after: '||example.com^$image',
        },
    ]);
    assert.deepEqual(diff.added, [ 'example.com##.new-ad' ]);
    assert.deepEqual(diff.removed, [ 'example.com##.old-ad' ]);
});

test('diff output is capped while preserving total counts', () => {
    const before = '||one.example^\n||two.example^\n||three.example^\n';
    const after = '||four.example^\n||five.example^\n||six.example^\n';
    const diff = createFilterListDiff(before, after, { limit: 2 });

    assert.equal(diff.addedCount, 3);
    assert.equal(diff.removedCount, 3);
    assert.equal(diff.added.length, 2);
    assert.equal(diff.removed.length, 2);
    assert.equal(diff.truncated, true);
});

test('unchanged rules produce an empty diff', () => {
    const diff = createFilterListDiff(
        '||example.com^\nexample.com##.ad\n',
        'example.com##.ad\n||example.com^\n'
    );

    assert.equal(filterListDiffIsEmpty(diff), true);
});
