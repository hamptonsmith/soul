'use strict';

const test = require('ava');
const validator = require('../../utils/validator');
const customSoulValidator = require('../../utils/soul-validate');

test('number assertion', async t => {
    await validator(5, check => check.number());
    await t.throwsAsync(
            () => validator('nope', check => check.number()),
            { instanceOf: validator.ValidationError });
    await t.throwsAsync(
            () => validator(true, check => check.number()),
            { instanceOf: validator.ValidationError });
    await t.throwsAsync(
            () => validator(null, check => check.number()),
            { instanceOf: validator.ValidationError });
    await t.throwsAsync(
            () => validator(undefined, check => check.number()),
            { instanceOf: validator.ValidationError });

    await t.throwsAsync(
            () => validator(5, check => check.number({
                min: 6
            })),
            { instanceOf: validator.ValidationError });

    await t.throwsAsync(
            () => validator(5, check => check.number({
                max: 4
            })),
            { instanceOf: validator.ValidationError });
});

test('string assertion', async t => {
    await validator('yep', check => check.string());
    await t.throwsAsync(
            () => validator(5, check => check.string()),
            { instanceOf: validator.ValidationError });
    await t.throwsAsync(
            () => validator(true, check => check.string()),
            { instanceOf: validator.ValidationError });
    await t.throwsAsync(
            () => validator(null, check => check.string()),
            { instanceOf: validator.ValidationError });
    await t.throwsAsync(
            () => validator(undefined, check => check.string()),
            { instanceOf: validator.ValidationError });

    await t.throwsAsync(
            () => validator('abc', check => check.string({
                minLength: 5
            })),
            { instanceOf: validator.ValidationError });

    await t.throwsAsync(
            () => validator('abc', check => check.string({
                maxLength: 2
            })),
            { instanceOf: validator.ValidationError });

    await t.throwsAsync(
            () => validator('abc', check => check.string({
                regexp: /d/
            })),
            { instanceOf: validator.ValidationError });
});

test('invalid assertion', async t => {
    await t.throwsAsync(
            () => validator({}, check => check.invalid('whoops')),
            {
                instanceOf: validator.ValidationError,
                message: /whoops/
            });
});

test('implicit object assertion', async t => {
    await validator({ foo: 'fooval' }, check => ({
        foo: check.string()
    }));

    await t.throwsAsync(() => validator({ foo: 5 }, check => ({
        foo: check.string()
    })), { instanceOf: validator.ValidationError });

    await t.throwsAsync(() => validator({}, check => ({
        foo: check.string()
    })), { instanceOf: validator.ValidationError });

    await t.throwsAsync(() => validator(null, check => ({
        foo: check.string()
    })), { instanceOf: validator.ValidationError });

    await t.throwsAsync(() => validator(undefined, check => ({
        foo: check.string()
    })), { instanceOf: validator.ValidationError });
});

test('explicit object assertion', async t => {
    await validator({ foo: 'fooval' }, check => check.object({
        foo: check.string()
    }));

    await t.throwsAsync(() => validator({ foo: 5 }, check => check.object({
        foo: check.string()
    })), { instanceOf: validator.ValidationError });

    await t.throwsAsync(() => validator({}, check => check.object({
        foo: check.string()
    })), { instanceOf: validator.ValidationError });

    await t.throwsAsync(() => validator(null, check => check.object({
        foo: check.string()
    })), { instanceOf: validator.ValidationError });

    await t.throwsAsync(() => validator(undefined, check => check.object({
        foo: check.string()
    })), { instanceOf: validator.ValidationError });

    await validator({ foo: 'fooval' }, check => check.object({}, {
        unknownEntries: {
            key: check.string({ regexp: /fo/ }),
            value: check.string()
        }
    }));

    await t.throwsAsync(async () => {
        await validator({ bar: 'fooval' }, check => check.object({}, {
            unknownEntries: {
                key: check.string({ regexp: /fo/ }),
                value: check.string()
            }
        }));
    }, { instanceOf: validator.ValidationError });

    await t.throwsAsync(async () => {
        await validator({ foo: 5 }, check => check.object({}, {
            unknownEntries: {
                key: check.string({ regexp: /fo/ }),
                value: check.string()
            }
        }));
    }, { instanceOf: validator.ValidationError });
});

test('array assertion', async t => {
    await validator(['a', 'b'],
            check => check.array({ elements: check.string() }));

    await validator(['a', 'b'],
            check => check.array({
                elements: check.string(),
                minLength: 1,
                maxLength: 5
            }));

    await t.throwsAsync(() => validator({ a: 'b' },
            check => check.array({ elements: check.boolean() })),
            { instanceOf: validator.ValidationError });

    await t.throwsAsync(() => validator(['a', 'b'],
            check => check.array({ elements: check.boolean() })),
            { instanceOf: validator.ValidationError });

    await t.throwsAsync(() => validator(['a', 'b'],
            check => check.array({
                elements: check.boolean(),
                minLength: 3
            })),
            { instanceOf: validator.ValidationError });

    await t.throwsAsync(() => validator(['a', 'b'],
            check => check.array({
                elements: check.boolean(),
                maxLength: 1
            })),
            { instanceOf: validator.ValidationError });
});

test('switch assertion', async t => {
    await validator(['a', 'b'],
            check => check.switch(actual => 'foo', {}, check.array()));

    await t.throwsAsync(() => validator(['a', 'b'],
            check => check.switch(actual => 'foo', {})),
            { instanceOf: validator.ValidationError });
});

test('union assertion', async t => {
    await validator(true, check => check.union(
            check.string(), check.number(), check.boolean()));

    await t.throwsAsync(async () => {
        await validator(true, check => check.union(
                check.string(), check.number()));
    }, {
        instanceOf: validator.ValidationError
    })

    t.pass();
});

test('hierarchy global schemas', async t => {
    function schema(check, actual) {
        check.appendHierarchyGlobalSchema(check.string({ maxLength: 1 }));
    }

    await validator({ foo: 'too long (but ok)' }, check => ({ bar: schema }));

    // May want to change this... need to think about what makes more sense.
    // Should the assertion start taking effect at the defined level?
    await validator({
        foo: 'too long (but ok)',
        bar: 'too long (but ok)'
    }, check => ({ bar: schema }));

    await t.throwsAsync(() => validator({
        foo: 'too long (but ok)',
        bar: {
            bazz: 'too long and not ok!'
        }
    }, check => ({ bar: schema })), { instanceOf: validator.ValidationError });
});

test('unknownEntries only applies at the current level', async t => {
    await validator({
        foo: {
            bar: 'something'
        }
    }, check => check.object({}, {
        unknownEntries: {
            key: check.string(),
            value: check.object()
        }
    }));

    t.pass();
});

test('invalid schemas', async t => {
    await t.throwsAsync(() => validator(null, 5), { message: /valid schema/ });
    await t.throwsAsync(
            () => validator(null, true), { message: /valid schema/ });
    await t.throwsAsync(
            () => validator(null, undefined), { message: /valid schema/ });
});

test('custom soulId assertion', async t => {
    await t.throwsAsync(() => customSoulValidator(5, check => check.soulId()),
            { instanceOf: validator.ValidationError });
    await t.throwsAsync(() => customSoulValidator('abc_12345',
            check => check.soulId('xyz')),
            { instanceOf: validator.ValidationError });

    let longId = 'xyz_';
    while (longId.length < 101) {
        longId += 'a';
    }

    await t.throwsAsync(() => customSoulValidator(longId,
            check => check.soulId()),
            { instanceOf: validator.ValidationError });

    await t.throwsAsync(() => customSoulValidator('xy$_12345',
            check => check.soulId()),
            { instanceOf: validator.ValidationError });

    await t.throwsAsync(() => customSoulValidator('xyz_12$45',
            check => check.soulId()),
            { instanceOf: validator.ValidationError });
});
