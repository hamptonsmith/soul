const hermeticTest = require('../hermetic-test');
const jsonpointer = require('json-pointer');
const test = require('ava');

test('add patch missing value', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {
    const error = await t.throwsAsync(soul.patch('/config/explicit', [
        {
            op: 'add',
            path: jsonpointer.compile(['jwks', 'https://weirdkey.com'])
        }
    ],
    {
        headers: {
            'Content-Type': 'application/json-patch+json'
        }
    }));

    t.is(error.response.data.code, 'VALIDATION_ERROR');
}));

test('bad content type', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {
    const error = await t.throwsAsync(soul.patch('/config/explicit', []));

    t.is(error.response.data.code, 'VALIDATION_ERROR');
}));

test('good etag', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {
    const { headers } = await soul.get('/config/explicit');

    await soul.patch('/config/explicit', [
        {
            op: 'add',
            path: jsonpointer.compile(['jwks', 'https://weirdkey.com']),
            value: { literal: { keys: [] }}
        }
    ],
    {
        headers: {
            'Content-Type': 'application/json-patch+json',
            'If-Match': '' + headers.etag
        }
    });

    t.pass();
}));

test('bad etag', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {
    const { headers } = await soul.get('/config/explicit');

    const error = await t.throwsAsync(soul.patch('/config/explicit', [
        {
            op: 'add',
            path: jsonpointer.compile(['jwks', 'https://weirdkey.com']),
            value: { literal: { keys: [] }}
        }
    ],
    {
        headers: {
            'Content-Type': 'application/json-patch+json',
            'If-Match': '' + (Number.parseInt(headers.etag) - 1)
        }
    }));

    t.is(error.response.data.code, 'VERSION_PRECONDITION_FAILED');
    t.is(error.response.status, 412);
}));
