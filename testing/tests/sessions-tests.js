'use strict';

const bs58 = require('bs58');
const defaultConfig = require('../../default-service-config');
const hermeticTest = require('../hermetic-test');
const test = require('ava');

test('dev mechanism', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: sessionData } = await soul.post(
            `/realms/${realmId}/sessions`, {
        mechanism: 'dev',
        securityContext: 'authenticated',
        jwtPayload: {
            iat: nower(),
            iss: 'http://me.com',
            sub: 'user123'
        }
    });

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/accessAttempts`,
            {
                securityContext: 'authenticated:0',
                sessionTokens: sessionData.addTokens
            });

    t.is(accessAttemptData.resolution, 'valid');
}));

test('sessions expire', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: sessionData } = await soul.post(
            `/realms/${realmId}/sessions`, {
        mechanism: 'dev',
        securityContext: 'authenticated',
        jwtPayload: {
            iat: nower(),
            iss: 'http://me.com',
            sub: 'user123'
        }
    });

    nower.advance(defaultConfig.defaultRealmSecurityContexts.authenticated
            .sessionOptions.inactivityExpirationDuration);
    nower.advance('1s');

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/accessAttempts`,
            {
                securityContext: 'authenticated:0',
                sessionTokens: sessionData.addTokens
            });

    t.deepEqual(accessAttemptData, {
        resolution: 'invalid-no-prejudice',
        relog: true
    });
}));

test('token w/ unknown protocol', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/accessAttempts`,
            {
                securityContext: 'authenticated:0',
                sessionTokens: [bs58.encode(Buffer.from([1]))]
            });

    t.is(accessAttemptData.resolution, 'invalid-no-prejudice');
}));

test('token w/ bad signature', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/accessAttempts`,
            {
                securityContext: 'authenticated:0',
                sessionTokens: [
                    // This buffer is full of zeros and thus it has the right
                    // protocol (0), but a nonsense signature (all zeroes) for
                    // its data (seven zeroes)
                    bs58.encode(Buffer.alloc(40))
                ]
            });

    t.is(accessAttemptData.resolution, 'invalid-no-prejudice');
}));

test('bad token encoding ignores token', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/accessAttempts`,
            {
                securityContext: 'authenticated:0',
                sessionTokens: [
                    // This isn't base58!
                    '!@#$%^&*'
                ]
            });

    t.is(accessAttemptData.resolution, 'invalid-no-prejudice');
}));
