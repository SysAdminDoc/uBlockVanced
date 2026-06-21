import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_CLASS_PATTERNS } from '../src/js/element-probe/page-scripts.js';

function classifyClasses(classes, patterns = DEFAULT_CLASS_PATTERNS) {
    const compiled = patterns.map(p => new RegExp(p));
    const stable = [];
    const dynamic = [];
    for (let i = 0; i < classes.length; i++) {
        const c = classes[i];
        let isDynamic = c.length > 40;
        if (!isDynamic) {
            for (let pi = 0; pi < compiled.length; pi++) {
                if (compiled[pi].test(c)) { isDynamic = true; break; }
            }
        }
        if (isDynamic) { dynamic.push(c); } else { stable.push(c); }
    }
    return { stable, dynamic };
}

describe('classifyClasses', () => {
    it('identifies standard class names as stable', () => {
        const result = classifyClasses(['container', 'main', 'sidebar']);
        assert.deepEqual(result.stable, ['container', 'main', 'sidebar']);
        assert.deepEqual(result.dynamic, []);
    });

    it('flags BEM-like short-prefix classes as dynamic (known limitation)', () => {
        const result = classifyClasses(['btn-primary']);
        assert.equal(result.dynamic.length, 1);
    });

    it('identifies CSS-in-JS hash classes as dynamic', () => {
        const result = classifyClasses(['css-1dbjc4n', 'css-abc123']);
        assert.equal(result.stable.length, 0);
        assert.equal(result.dynamic.length, 2);
    });

    it('identifies styled-components classes as dynamic', () => {
        const result = classifyClasses(['sc-bdfBwQ', 'sc-abc123xyz']);
        assert.equal(result.stable.length, 0);
        assert.equal(result.dynamic.length, 2);
    });

    it('identifies emotion classes as dynamic', () => {
        const result = classifyClasses(['emotion-abc123']);
        assert.equal(result.stable.length, 0);
        assert.equal(result.dynamic.length, 1);
    });

    it('identifies hex hash classes as dynamic', () => {
        const result = classifyClasses(['a1b2c3d4e5f6', 'deadbeef']);
        assert.equal(result.stable.length, 0);
        assert.equal(result.dynamic.length, 2);
    });

    it('identifies underscore-prefixed hashes as dynamic', () => {
        const result = classifyClasses(['_1a2b3c4d', '_abcdef1234']);
        assert.equal(result.stable.length, 0);
        assert.equal(result.dynamic.length, 2);
    });

    it('identifies very long class names as dynamic', () => {
        const longClass = 'a'.repeat(41);
        const result = classifyClasses([longClass]);
        assert.equal(result.stable.length, 0);
        assert.equal(result.dynamic.length, 1);
    });

    it('identifies short obfuscated patterns (e.g. ab-Abc123def) as dynamic', () => {
        const result = classifyClasses(['ab-Abc123def']);
        assert.equal(result.dynamic.length, 1);
    });

    it('handles mixed stable and dynamic classes', () => {
        const result = classifyClasses(['card', 'css-1x2y3z', 'visible', 'sc-aBcDeFg']);
        assert.deepEqual(result.stable, ['card', 'visible']);
        assert.equal(result.dynamic.length, 2);
    });

    it('handles empty input', () => {
        const result = classifyClasses([]);
        assert.deepEqual(result.stable, []);
        assert.deepEqual(result.dynamic, []);
    });

    it('recognizes PascalCase long names as dynamic (React/Angular generated)', () => {
        const result = classifyClasses(['MuiButtonBaseRippleChild']);
        assert.equal(result.dynamic.length, 1);
    });

    it('keeps short semantic names stable', () => {
        const result = classifyClasses(['ad', 'nav', 'header', 'footer', 'active']);
        assert.deepEqual(result.stable, ['ad', 'nav', 'header', 'footer', 'active']);
        assert.deepEqual(result.dynamic, []);
    });

    it('works with custom patterns', () => {
        const custom = ['^custom-\\d+$'];
        const result = classifyClasses(['custom-123', 'normal'], custom);
        assert.deepEqual(result.stable, ['normal']);
        assert.deepEqual(result.dynamic, ['custom-123']);
    });
});
