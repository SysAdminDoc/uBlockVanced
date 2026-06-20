import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Extracted from element-probe-panel.js isProcedural regex
const PROCEDURAL_RE = /:has-text|:upward|:matches-path|:matches-attr|:matches-css|:matches-prop|:min-text-length|:remove\(\)|:not\(:has-text\(/;

describe('isProcedural detection', () => {
    it('detects :has-text()', () => {
        assert.ok(PROCEDURAL_RE.test('div:has-text(Subscribe)'));
    });

    it('detects :upward()', () => {
        assert.ok(PROCEDURAL_RE.test('span.ad:upward(2)'));
    });

    it('detects :matches-path()', () => {
        assert.ok(PROCEDURAL_RE.test('div:matches-path(/video/)'));
    });

    it('detects :matches-attr()', () => {
        assert.ok(PROCEDURAL_RE.test('div:matches-attr("data-ad")'));
    });

    it('detects :matches-css()', () => {
        assert.ok(PROCEDURAL_RE.test('div:matches-css(position: fixed)'));
    });

    it('detects :min-text-length()', () => {
        assert.ok(PROCEDURAL_RE.test('p:min-text-length(20)'));
    });

    it('detects :remove()', () => {
        assert.ok(PROCEDURAL_RE.test('div.banner:remove()'));
    });

    it('detects :not(:has-text())', () => {
        assert.ok(PROCEDURAL_RE.test('div:not(:has-text(Keep))'));
    });

    it('does not flag standard CSS selectors', () => {
        assert.ok(!PROCEDURAL_RE.test('div.ad'));
        assert.ok(!PROCEDURAL_RE.test('#banner'));
        assert.ok(!PROCEDURAL_RE.test('div > span.close'));
        assert.ok(!PROCEDURAL_RE.test('div:nth-of-type(2)'));
        assert.ok(!PROCEDURAL_RE.test('div:has(> img)'));
    });

    it('does not flag :hover, :focus, etc.', () => {
        assert.ok(!PROCEDURAL_RE.test('a:hover'));
        assert.ok(!PROCEDURAL_RE.test('input:focus'));
        assert.ok(!PROCEDURAL_RE.test('div:first-child'));
    });
});

describe('filter format parsing', () => {
    const FILTER_RE = /^(.+?)(##|#@#)(.+)$/;

    it('parses block filter', () => {
        const m = 'example.com##div.ad'.match(FILTER_RE);
        assert.ok(m);
        assert.equal(m[1], 'example.com');
        assert.equal(m[2], '##');
        assert.equal(m[3], 'div.ad');
    });

    it('parses exception filter', () => {
        const m = 'example.com#@#div.ad'.match(FILTER_RE);
        assert.ok(m);
        assert.equal(m[1], 'example.com');
        assert.equal(m[2], '#@#');
        assert.equal(m[3], 'div.ad');
    });

    it('parses wildcard hostname', () => {
        const m = '*##div.ad'.match(FILTER_RE);
        assert.ok(m);
        assert.equal(m[1], '*');
    });

    it('parses filter with :remove() action', () => {
        const m = 'example.com##div.banner:remove()'.match(FILTER_RE);
        assert.ok(m);
        assert.equal(m[3], 'div.banner:remove()');
    });
});
