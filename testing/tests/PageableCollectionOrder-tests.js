'use strict';

const bs58 = require('bs58');
const hermeticTest = require('../hermetic-test');
const PageableCollectionOrder = require('../../utils/PageableCollectionOrder');
const test = require('ava');

test('ascending', hermeticTest(async (t, { dbClient }) => {

    const order = new PageableCollectionOrder(
            'fooOrder',
            dbClient.collection('foo'),
            [['bar', 1]],
            d => { delete d._id; return d; });

    await dbClient.collection('foo').insertMany([
        { bar: 3 },
        { bar: -3 },
        { bar: 10 }
    ]);

    let after = '';
    const docs = [];
    while (after !== undefined) {
        const nextPage = await order.find({}, after, 1);

        for (const d of nextPage.docs) {
            docs.push(d);
        }

        after = nextPage.after;
    }

    t.deepEqual(
        docs,
        [
            { bar: -3 },
            { bar: 3 },
            { bar: 10 }
        ]
    );

}));

test('descending', hermeticTest(async (t, { dbClient }) => {
    const order = new PageableCollectionOrder(
            'fooOrder',
            dbClient.collection('foo'),
            [['bar', -1]],
            d => { delete d._id; return d; });

    await dbClient.collection('foo').insertMany([
        { bar: 3 },
        { bar: -3 },
        { bar: 10 }
    ]);

    let after = '';
    const docs = [];
    while (after !== undefined) {
        const nextPage = await order.find({}, after, 1);

        for (const d of nextPage.docs) {
            docs.push(d);
        }

        after = nextPage.after;
    }

    t.deepEqual(
        docs,
        [
            { bar: 10 },
            { bar: 3 },
            { bar: -3 }
        ]
    );
}));

test('filter', hermeticTest(async (t, { dbClient }) => {

    const order = new PageableCollectionOrder(
            'fooOrder',
            dbClient.collection('foo'),
            [['bar', 1]],
            d => { delete d._id; return d; },
            {
                bar: (query, value) => {
                    query.bar = { $gt: value };
                }
            });

    await dbClient.collection('foo').insertMany([
        { bar: -3 },
        { bar: 3 },
        { bar: 10 }
    ]);

    const { docs } = await order.find({ bar: 1 });

    t.deepEqual(
        docs,
        [
            { bar: 3 },
            { bar: 10 }
        ]
    );

}));

test('no such filter', hermeticTest(async (t, { dbClient }) => {

    const order = new PageableCollectionOrder(
            'fooOrder',
            dbClient.collection('foo'),
            [],
            d => d,
            {});

    t.throwsAsync(() => order.find({ bazz: 1 }), { message: /bazz/ });
}));

test('after token has wrong number of fields', hermeticTest(
        async (t, { soul }) => {

    const badAfter = bs58.encode(Buffer.from(JSON.stringify([
        'a', 'b', 'c'
    ]), 'utf8'));

    try {
        await soul.get(`/realms?after=${badAfter}`);
        t.fail();
    }
    catch (e) {
        t.is(e.response.data.code, 'INTERNAL_SERVER_ERROR');
    }
}));
