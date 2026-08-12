import test from 'node:test';
import assert from 'node:assert/strict';

import { parseFilterExportText } from '../src/js/filter-export.js';

test('parseFilterExportText preserves leading comments as rule notes', () => {
    const result = parseFilterExportText([
        '! Hide the player chrome',
        '! Keep this scoped to the video host',
        'example.com##.player',
        '',
        '! Exception for the settings page',
        'example.com#@#.settings',
    ].join('\n'));

    assert.deepEqual(result.rules, [
        {
            raw: 'example.com##.player',
            type: 'cosmetic',
            domains: 'example.com',
            selector: '.player',
            notes: [
                'Hide the player chrome',
                'Keep this scoped to the video host',
            ],
        },
        {
            raw: 'example.com#@#.settings',
            type: 'exception',
            domains: 'example.com',
            selector: '.settings',
            notes: ['Exception for the settings page'],
        },
    ]);
    assert.deepEqual(result.unassignedNotes, []);
});

test('parseFilterExportText keeps trailing comments separate', () => {
    const result = parseFilterExportText([
        '||ads.example^',
        '! Review this rule after the next list update',
    ].join('\n'));

    assert.equal(result.rules[0].type, 'network');
    assert.deepEqual(result.rules[0].notes, []);
    assert.deepEqual(result.unassignedNotes, [
        'Review this rule after the next list update',
    ]);
});
