import {
    getUserFilterDisabledSites,
    isUserFilterSiteDisabled,
    normalizeHostname,
    setUserFilterDisabledSites,
} from '../src/js/user-filters.js';
import assert from 'node:assert/strict';
import test from 'node:test';

test('normalizeHostname accepts hostnames and URL input', () => {
    assert.equal(normalizeHostname(' Example.COM. '), 'example.com');
    assert.equal(
        normalizeHostname('https://Sub.Example.com/settings'),
        'sub.example.com'
    );
    assert.equal(normalizeHostname('*.example.com'), 'example.com');
    assert.equal(normalizeHostname('not a hostname'), undefined);
});

test('isUserFilterSiteDisabled includes subdomains', () => {
    setUserFilterDisabledSites([ 'Example.com', 'invalid value' ]);

    assert.deepEqual(getUserFilterDisabledSites(), [ 'example.com' ]);
    assert.equal(isUserFilterSiteDisabled('example.com'), true);
    assert.equal(isUserFilterSiteDisabled('www.example.com'), true);
    assert.equal(isUserFilterSiteDisabled('example.net'), false);

    setUserFilterDisabledSites([]);
});
