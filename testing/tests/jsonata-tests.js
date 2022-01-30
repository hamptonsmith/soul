'use strict';

const JsonataService = require('../../services/jsonata');
const test = require('ava');

test('unexpected error during compilation', async t => {
    const jsonata = new JsonataService();
    const error = await t.throwsAsync(
            (async () => jsonata.evaluate(null, null, null))());

    t.is(error.code, 'UNEXPECTED_ERROR');
});

test('unexpected error during runtime', async t => {
    const jsonata = new JsonataService({
        jsonata: () => ({
            evaluate: (x, y, cb) => cb(new Error('out of cheese'))
        })
    });

    const error = await t.throwsAsync((async () => jsonata.evaluate('true'))());

    t.is(error.code, 'UNEXPECTED_ERROR');
});
