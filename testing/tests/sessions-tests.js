'use strict';

const defaultConfig = require('../../default-service-config');
const hermeticTest = require('../hermetic-test');
const test = require('ava');

test('create dev session w/ new user', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: sessionData } = await soul.post(
            `/realms/${realmId}/sessions`, {
        mechanism: 'dev',
        metadata: {},
        newUserOk: true,
        userId: 'usr_testuser'
    });

    const { data: accessAttemptData } = await soul.post(`/realms/${realmId}`
            + `/accessAttempts`, { sessionTokens: sessionData.sessionTokens });

    t.is(accessAttemptData.resolution, 'valid');
    t.is(accessAttemptData.session.userId, 'usr_testuser');
}));

test('create dev session w/ existing user', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    await soul.post(`/realms/${realmId}/sessions`, {
        mechanism: 'dev',
        metadata: {},
        newUserOk: true,
        userId: 'usr_testuser'
    });

    const { data: sessionData } = await soul.post(
            `/realms/${realmId}/sessions`, {
        mechanism: 'dev',
        metadata: {},
        existingUserOk: true,
        userId: 'usr_testuser'
    });

    const { data: accessAttemptData } = await soul.post(`/realms/${realmId}`
            + `/accessAttempts`, { sessionTokens: sessionData.sessionTokens });

    t.is(accessAttemptData.resolution, 'valid');
    t.is(accessAttemptData.session.userId, 'usr_testuser');
}));

test('sessions expire', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: sessionData } = await soul.post(
            `/realms/${realmId}/sessions`, {
        mechanism: 'dev',
        metadata: {},
        newUserOk: true,
        userId: 'usr_testuser'
    });

    nower.advance(defaultConfig.defaultSessionInactivityExpirationDuration);
    nower.advance('1s');

    const { data: accessAttemptData } = await soul.post(`/realms/${realmId}`
            + `/accessAttempts`, { sessionTokens: sessionData.sessionTokens });

    t.deepEqual(accessAttemptData, {
        resolution: 'invalid-no-prejudice',
        relog: true
    });
}));
