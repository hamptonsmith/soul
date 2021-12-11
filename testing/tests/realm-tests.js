'use strict';

const hermeticTest = require('../hermetic-test');
const test = require('ava');

test('zero realms by default', hermeticTest(async (t, { soul }) => {
    t.deepEqual(
        (await soul.get('/realms')).data,
        {
            resources: []
        }
    );
}));

test('create default realm', hermeticTest(
        async (t, { config: { publicBaseHref }, soul, nower }) => {

    const postResult = await soul.post('/realms');

    t.is(postResult.status, 201);
    t.deepEqual(postResult.data, {
        id: postResult.data.id,
        friendlyName: '',
        createdAt: new Date(nower()).toISOString(),
        updatedAt: new Date(nower()).toISOString(),
        userSpecifierSet: ['emailAddress'],
        href: `${publicBaseHref}/realms/${postResult.data.id}`
    });

    const getResult = await soul.get('/realms');

    t.is(getResult.status, 200);
    t.deepEqual(getResult.data, {
        resources: [
            {
                id: postResult.data.id,
                friendlyName: '',
                createdAt: new Date(nower()).toISOString(),
                updatedAt: new Date(nower()).toISOString(),
                userSpecifierSet: ['emailAddress'],
                href: `${publicBaseHref}/realms/${postResult.data.id}`
            }
        ]
    });
}));

test('create non-default realm', hermeticTest(
        async (t, { config: { publicBaseHref }, soul, nower }) => {

    const postResult = await soul.post('/realms', {
        friendlyName: 'Some realm',
        userSpecifierSet: ['foo', 'bar']
    });

    t.is(postResult.status, 201);
    t.deepEqual(postResult.data, {
        id: postResult.data.id,
        friendlyName: 'Some realm',
        createdAt: new Date(nower()).toISOString(),
        updatedAt: new Date(nower()).toISOString(),
        userSpecifierSet: ['foo', 'bar'],
        href: `${publicBaseHref}/realms/${postResult.data.id}`
    });

    const getResult = await soul.get('/realms');

    t.is(getResult.status, 200);
    t.deepEqual(getResult.data, {
        resources: [
            {
                id: postResult.data.id,
                friendlyName: 'Some realm',
                createdAt: new Date(nower()).toISOString(),
                updatedAt: new Date(nower()).toISOString(),
                userSpecifierSet: ['foo', 'bar'],
                href: `${publicBaseHref}/realms/${postResult.data.id}`
            }
        ]
    });
}));

test('realm pagination by `continueToken`', hermeticTest(
        async (t, { config: { publicBaseHref }, soul, nower }) => {

    const expectedFriendlyNames = [];
    for (let i = 0; i < 50; i++) {
        await soul.post('/realms', {
            friendlyName: `Realm ${i}`,
            userSpecifierSet: ['foo', 'bar']
        });

        expectedFriendlyNames.push(`Realm ${i}`);
        nower.setNow(nower() + 1000);
    }

    const actualFriendlyNames = [];
    let data = {};
    while (actualFriendlyNames.length === 0 || data.continueToken) {
        const continueThing =
                data.continueToken ? '&after=' + data.continueToken : '';
        ({ data } = await soul.get(`/realms?limit=5${continueThing}`));
        data.resources.forEach(r => actualFriendlyNames.push(r.friendlyName));

        t.is(data.resources.length, 5);
    }

    t.deepEqual(actualFriendlyNames, expectedFriendlyNames);
}));
