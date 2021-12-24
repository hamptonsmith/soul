'use strict';

const test = require('ava');
const validator = require('../../utils/validator');

test('string assertion', async t => {
    await validator('yep', check => check.string());
    await t.throwsAsync(() => validator(5, check => check.string()));
    await t.throwsAsync(() => validator(true, check => check.string()));
    await t.throwsAsync(() => validator(null, check => check.string()));
    await t.throwsAsync(() => validator(undefined, check => check.string()));
});

test('object assertion', async t => {
    await validator({ foo: 'fooval' }, check => ({
        foo: check.string()
    }));

    await t.throwsAsync(() => validator({ foo: 5 }, check => ({
        foo: check.string()
    })));

    await t.throwsAsync(() => validator({}, check => ({
        foo: check.string()
    })));
});
