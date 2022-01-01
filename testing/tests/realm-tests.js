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
        async (t, { baseHref, soul, nower }) => {

    const postResult = await soul.post('/realms');

    const realmData = {
        id: postResult.data.id,
        friendlyName: '',
        createdAt: new Date(nower()).toISOString(),
        href: `${baseHref}/realms/${postResult.data.id}`,
        securityContexts: {
            anonymous: {
                precondition: 'true',
                sessionOptions: {},
                versionNumber: 0
            },
            authenticated: {
                precondition: 'claim.sub and claim.iat >= $now - $ms("5m")',
                sessionOptions: {
                    inactivityExpirationDuration: '90d'
                },
                versionNumber: 0
            },
            secure: {
                precondition: 'claim.sub and claim.iat >= $now - $ms("5m")',
                sessionOptions: {
                    absoluteExpirationDuration: '6h',
                    inactivityExpirationDuration: '30m'
                },
                versionNumber: 0
            }
        },
        updatedAt: new Date(nower()).toISOString()
    };

    t.is(postResult.status, 201);
    t.deepEqual(postResult.data, realmData);

    const getResult = await soul.get('/realms');

    t.is(getResult.status, 200);
    t.deepEqual(getResult.data, {
        resources: [ realmData ]
    });
}));

test('create non-default realm', hermeticTest(
        async (t, { baseHref, soul, nower }) => {

    const postResult = await soul.post('/realms', {
        friendlyName: 'Some realm',
        securityContexts: {
            foo: {
                precondition: 'foo.bar.bazz',
                sessionOptions: {
                    absoluteExpirationDuration: '1ms',
                    inactivityExpirationDuration: '2ms'
                }
            }
        }
    });

    t.is(postResult.status, 201);
    t.deepEqual(postResult.data, {
        id: postResult.data.id,
        friendlyName: 'Some realm',
        createdAt: new Date(nower()).toISOString(),
        href: `${baseHref}/realms/${postResult.data.id}`,
        securityContexts: {
            foo: {
                precondition: 'foo.bar.bazz',
                sessionOptions: {
                    absoluteExpirationDuration: '1ms',
                    inactivityExpirationDuration: '2ms'
                },
                versionNumber: 0
            }
        },
        updatedAt: new Date(nower()).toISOString()
    });

    const getResult = await soul.get('/realms');

    t.is(getResult.status, 200);
    t.deepEqual(getResult.data, {
        resources: [
            {
                id: postResult.data.id,
                friendlyName: 'Some realm',
                createdAt: new Date(nower()).toISOString(),
                href: `${baseHref}/realms/${postResult.data.id}`,
                securityContexts: {
                    foo: {
                        precondition: 'foo.bar.bazz',
                        sessionOptions: {
                            absoluteExpirationDuration: '1ms',
                            inactivityExpirationDuration: '2ms'
                        },
                        versionNumber: 0
                    }
                },
                updatedAt: new Date(nower()).toISOString()
            }
        ]
    });
}));

test('realm pagination by `continueToken`', hermeticTest(
        async (t, { soul, nower }) => {

    const expectedFriendlyNames = [];
    for (let i = 0; i < 50; i++) {
        await soul.post('/realms', {
            friendlyName: `Realm ${i}`
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

test('GET /realms/:realmId', hermeticTest(
        async (t, { baseHref, soul, nower }) => {

    const postResult = await soul.post('/realms');
    const getResult = await soul.get(`/realms/${postResult.data.id}`);

    t.is(getResult.status, 200);
    t.deepEqual(getResult.data, {
        id: postResult.data.id,
        friendlyName: '',
        createdAt: new Date(nower()).toISOString(),
        href: `${baseHref}/realms/${postResult.data.id}`,
        securityContexts: {
            anonymous: {
                precondition: 'true',
                sessionOptions: {},
                versionNumber: 0
            },
            authenticated: {
                precondition: 'claim.sub and claim.iat >= $now - $ms("5m")',
                sessionOptions: {
                    inactivityExpirationDuration: '90d'
                },
                versionNumber: 0
            },
            secure: {
                precondition: 'claim.sub and claim.iat >= $now - $ms("5m")',
                sessionOptions: {
                    absoluteExpirationDuration: '6h',
                    inactivityExpirationDuration: '30m'
                },
                versionNumber: 0
            }
        },
        updatedAt: new Date(nower()).toISOString()
    });
}));

test('GET /realms/:realmId - no such realm', hermeticTest(
        async (t, { baseHref, soul, nower }) => {

    const error = await t.throwsAsync(soul.get('/realms/rlm_nosuchrealm'));

    t.is(error.response.status, 404);
    t.is(error.response.data.code, 'NO_SUCH_REALM');
}));
