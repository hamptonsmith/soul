'use strict';

const bs58 = require('bs58');
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

test('token w/ unknown protocol', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: accessAttemptData } = await soul.post(`/realms/${realmId}`
            + `/accessAttempts`, { sessionTokens: [
                bs58.encode(Buffer.from([1]))
            ] });

    t.is(accessAttemptData.resolution, 'invalid-no-prejudice');
}));

test('token w/ bad signature', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: accessAttemptData } = await soul.post(`/realms/${realmId}`
            + `/accessAttempts`, { sessionTokens: [

                // This buffer is full of zeros and thus it has the right
                // protocol (0), but a nonsense signature (all zeroes) for its
                // data (seven zeroes)
                bs58.encode(Buffer.alloc(40))
            ] });

    t.is(accessAttemptData.resolution, 'invalid-no-prejudice');
}));

test('token creates error', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: accessAttemptData } = await soul.post(`/realms/${realmId}`
            + `/accessAttempts`, { sessionTokens: [
                // This isn't base58 and so will throw
                '!@#$%^&*()_+'
            ] });

    t.is(accessAttemptData.resolution, 'invalid-no-prejudice');
}));
