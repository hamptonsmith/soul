'use strict';

const hermeticTest = require('../hermetic-test');
const optimisticDocument = require('../../utils/OptimisticDocument');
const test = require('ava');

test('poll finds change', hermeticTest(
        async (t, { dbClient, errorReporter, schedule }) => {

    const col = dbClient.collection('fooCol');

    const d1 = await optimisticDocument(
            col, 'fooDoc', {}, { errorReporter, schedule, label: 'd1' });
    const d2 = await optimisticDocument(
            col, 'fooDoc', {}, { errorReporter, schedule, label: 'd2' });

    let v2;

    d2.on('documentChanged', v => {
        v2 = v;
    });

    await d1.update(async o => {
        o.something = 'new';
    });

    await schedule.step();

    t.deepEqual(v2, { something: 'new'});
}));

test('updating pulls down change', hermeticTest(
        async (t, { dbClient, errorReporter, schedule }) => {

    const col = dbClient.collection('fooCol');

    const d1 = await optimisticDocument(
            col, 'fooDoc', {}, { errorReporter, schedule, label: 'd1' });
    const d2 = await optimisticDocument(
            col, 'fooDoc', {}, { errorReporter, schedule, label: 'd2' });

    let v2s = [];

    d2.on('documentChanged', v => {
        v2s.push(v);
    });

    await d1.update(async o => {
        o.something = 'new';
    });

    await d2.update(async o => {
        o.somethingElse = 'also new';
    });

    t.deepEqual(v2s, [
        { something: 'new'},
        {
            something: 'new',
            somethingElse: 'also new'
        }
    ]);
}));

test('poll crash reports and keeps chugging', hermeticTest(
        async (t, { dbClient, errorReporter, schedule }) => {

    const col = dbClient.collection('fooCol');

    const d1 = await optimisticDocument(
            col, 'fooDoc', {}, { errorReporter, schedule, label: 'd1' });

    let callCount = 0;

    dbClient.addInterceptor(
        (dbName, colName, methodName, [firstArg]) =>
                methodName === 'findOne'
                && firstArg._id === 'fooDoc',
        () => {
            callCount++;

            if (callCount === 1) {
                throw new Error('Out of cheese.');
            }
        }
    );

    await schedule.step();
    await schedule.step();

    t.is(callCount, 2);
    t.is(errorReporter.reports.warning.length, 1);
}));

test('optimistic lock failure retries', hermeticTest(
        async (t, { dbClient, errorReporter, schedule }) => {

    const col = dbClient.collection('fooCol');

    const d1 = await optimisticDocument(
            col, 'fooDoc', {}, { errorReporter, schedule });
    const d2 = await optimisticDocument(
            col, 'fooDoc', {}, { errorReporter, schedule });

    dbClient.addInterceptor(
        (dbName, colName, methodName, [,secondArg]) =>
                methodName === 'replaceOne'
                && secondArg.data.preempt
                && !secondArg.data.somethingNew,
        async (x, y, z, args) => {
            await d2.update(data => {
                data.somethingNew = 'yep!';
            }, () => true);
        }
    );

    // The default conflict function performs a snooze, which complicates our
    // fake timers, so we replace with a noop.
    await d1.update(data => {
        data.myUpdate = 'd1';
        data.preempt = true;
    }, () => true);

    t.deepEqual(d1.getData(), {
        somethingNew: 'yep!',
        myUpdate: 'd1',
        preempt: true
    });
}));

test('random error during update passed up the chain', hermeticTest(
        async (t, { dbClient, errorReporter, schedule }) => {

    const col = dbClient.collection('fooCol');

    const d1 = await optimisticDocument(
            col, 'fooDoc', {}, { errorReporter, schedule, label: 'd1' });

    dbClient.addInterceptor(
        (dbName, colName, methodName, [firstArg]) =>
                methodName === 'replaceOne',
        () => {
            throw new Error('Out of cheese.');
        }
    );

    const error = await t.throwsAsync(() => d1.update(data => {
        data.something = 'new';
    }));

    t.is(error.cause.message, 'Out of cheese.');
}));

test('default onConflictFn', hermeticTest(
        async (t, { dbClient, errorReporter, schedule }) => {

    const col = dbClient.collection('fooCol');

    const d1 = await optimisticDocument(
            col, 'fooDoc', {}, { errorReporter, schedule, label: 'd1' });

    let callCount = 0;

    dbClient.addInterceptor(
        (dbName, colName, methodName, [firstArg]) =>
                methodName === 'replaceOne',
        () => {
            callCount++;

            const e = new Error();
            e.code = 11000;
            throw e;
        }
    );

    const resultPromise = d1.update(data => {
        data.something = 'new';
    });

    let tries = 0;
    while (callCount < 3 && tries < 1000) {
        await schedule.step();
        tries++;
    }

    t.is(callCount, 3);

    const error = await t.throwsAsync(() => resultPromise);

    t.is(error.code, 'UNEXPECTED_ERROR');
}));
