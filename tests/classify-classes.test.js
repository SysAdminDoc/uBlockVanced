import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Extracted from element-probe-panel.js INSPECT_SCRIPT classifyClasses()
function classifyClasses(classes) {
    const stable = [];
    const dynamic = [];
    for (let i = 0; i < classes.length; i++) {
        const c = classes[i];
        if (/^[a-z]{1,3}-[a-zA-Z0-9]{6,}$/.test(c) ||
            /^_[0-9a-f]{4,}/.test(c) ||
            /^[A-Z][a-zA-Z0-9]{20,}$/.test(c) ||
            /^css-[a-z0-9]+$/.test(c) ||
            /^[a-f0-9]{8,}$/.test(c) ||
            /^sc-[a-zA-Z0-9]+$/.test(c) ||
            /^emotion-[a-z0-9]+$/.test(c) ||
            /^_[A-Za-z0-9]{8,}$/.test(c) ||
            /^styled-[a-z0-9]+$/.test(c) ||
            /^[a-z]{1,2}[A-Z][a-zA-Z0-9]{10,}$/.test(c) ||
            c.length > 40) {
            dynamic.push(c);
        } else {
            stable.push(c);
        }
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
        // btn-primary matches the obfuscation regex ^[a-z]{1,3}-[a-zA-Z0-9]{6,}$
        // This is a false positive but acceptable — the heuristic errs on caution
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
});
