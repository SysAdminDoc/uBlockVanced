import {
    normalizeFilterImportText,
    parseFilterExportText,
} from '../src/js/filter-export.js';
import assert from 'node:assert/strict';
import test from 'node:test';

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
            separator: '##',
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
            separator: '#@#',
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

test('parseFilterExportText recognizes AdGuard and ABP cosmetic separators', () => {
    const result = parseFilterExportText([
        'example.com#?#div:contains(Ad)',
        'example.com#$#body { remove: true; }',
        'example.com#@?#.keep',
    ].join('\n'));

    assert.deepEqual(
        result.rules.map(rule => [rule.type, rule.separator]),
        [
            [ 'cosmetic', '#?#' ],
            [ 'cosmetic', '#$#' ],
            [ 'exception', '#@?#' ],
        ]
    );
});

test('normalizeFilterImportText annotates and normalizes procedural aliases', () => {
    const result = normalizeFilterImportText(
        'example.com#?#div:matches-property(foo)'
    );

    assert.match(result.text, /uBlockVanced import note/);
    assert.match(result.text, /:matches-prop\(foo\)/);
    assert.equal(result.notes.length, 1);
});

test('normalizeFilterImportText leaves unsupported procedural syntax visible', () => {
    const result = normalizeFilterImportText(
        'example.com#?#div:contains-own(Ad)'
    );

    assert.match(result.text, /may not compile in uBO/);
    assert.match(result.text, /:contains-own\(Ad\)/);
});
