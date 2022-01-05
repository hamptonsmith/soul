'use strict';

const bs58 = require('bs58');
const defaultConfig = require('../../default-service-config');
const hermeticTest = require('../hermetic-test');
const jsonwebtoken = require('jsonwebtoken');
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

test('idToken mechanism', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: sessionData } = await soul.post(
            `/realms/${realmId}/sessions`, {
        mechanism: 'idToken',
        securityContext: 'authenticated',
        token: await buildJwt(
                'https://local.literal.key.com',
                'HS256', 'key1', {
                    sub: 'testuser1'
                })
    });

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/accessAttempts`,
            {
                securityContext: 'authenticated:0',
                sessionTokens: sessionData.addTokens
            });

    t.is(accessAttemptData.resolution, 'valid');
}));

test('rsa key', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: sessionData } = await soul.post(
            `/realms/${realmId}/sessions`, {
        mechanism: 'idToken',
        securityContext: 'authenticated',
        token: await buildJwt(
                'https://local.literal.key.com',
                'RS256', 'key2', {
                    sub: 'testuser1'
                })
    });

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/accessAttempts`,
            {
                securityContext: 'authenticated:0',
                sessionTokens: sessionData.addTokens
            });

    t.is(accessAttemptData.resolution, 'valid');
}));

test('issuer w/ suspicious name', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const error = await t.throwsAsync(soul.post(
            `/realms/${realmId}/sessions`,
            {
                mechanism: 'idToken',
                securityContext: 'authenticated',
                token: await buildJwt(
                        'https://local.literal.key.com', 'HS256',
                        'key1', { iss: '__proto__', sub: 'testuser1' })
            }));

    t.is(error.response.data.code, 'UNFAMILIAR_AUTHORITY');
}));

test('unknown issuer', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const error = await t.throwsAsync(soul.post(
            `/realms/${realmId}/sessions`,
            {
                mechanism: 'idToken',
                securityContext: 'authenticated',
                token: await buildJwt(
                        'https://local.literal.key.com', 'HS256',
                        'key1',
                        {
                            iss: 'https://unknown.com',
                            sub: 'testuser1'
                        })
            }));

    t.is(error.response.data.code, 'UNFAMILIAR_AUTHORITY');
}));

test('misconfigured issuer', hermeticTest({
    config: baseConfig => ({
        jwks: {
            'https://misconfigured.com': {},

            ...baseConfig.jwks
        }
    })
}, async (t, { buildJwt, soul, nower }) => {
    const { data: { id: realmId }} = await soul.post('/realms');

    const error = await t.throwsAsync(soul.post(
            `/realms/${realmId}/sessions`,
            {
                mechanism: 'idToken',
                securityContext: 'authenticated',
                token: await buildJwt(
                        'https://local.literal.key.com', 'HS256',
                        'key1',
                        {
                            iss: 'https://misconfigured.com',
                            sub: 'testuser1'
                        })
            }));

    t.is(error.response.data.code, 'UNFAMILIAR_AUTHORITY');
}));

test('no such key for issuer', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {
    const { data: { id: realmId }} = await soul.post('/realms');

    const error = await t.throwsAsync(soul.post(
            `/realms/${realmId}/sessions`,
            {
                mechanism: 'idToken',
                securityContext: 'authenticated',
                token: jsonwebtoken.sign(
                    {
                        iss: 'https://local.literal.key.com'
                    },
                    Buffer.from('anysecretwilldo'),
                    {
                        keyid: 'noSuchKeyId'
                    })
            }));

    t.is(error.response.data.code, 'NO_SUCH_KEY');
}));

test('unknown kty', hermeticTest({
    config: baseConfig => ({
        jwks: {
            'https://weirdkey.com': {
                literal: {
                    keys: [
                        {
                            alg: 'HS256',
                            kid: 'key1',
                            kty: 'foo',
                            use: 'sig'
                        }
                    ]
                }
            },

            ...baseConfig.jwks
        }
    })
}, async (t, { buildJwt, soul, nower }) => {
    const { data: { id: realmId }} = await soul.post('/realms');

    const error = await t.throwsAsync(soul.post(
            `/realms/${realmId}/sessions`,
            {
                mechanism: 'idToken',
                securityContext: 'authenticated',
                token: jsonwebtoken.sign(
                    {
                        iss: 'https://weirdkey.com'
                    },
                    Buffer.from('anysecretwilldo'),
                    {
                        keyid: 'key1'
                    })
            }));

    t.is(error.response.data.code, 'NO_SUCH_KEY');
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

test('same agent fingerprint succeeds', hermeticTest(
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

    await soul.post(
            `/realms/${realmId}/accessAttempts`,
            {
                agentFingerprint: 'abcdef',
                securityContext: 'authenticated:0',
                sessionTokens: sessionData.addTokens
            });

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/accessAttempts`,
            {
                agentFingerprint: 'abcdef',
                securityContext: 'authenticated:0',
                sessionTokens: sessionData.addTokens
            });

    t.is(accessAttemptData.resolution, 'valid');
}));

test('different agent fingerprint invalidates session w/ prejudice',
        hermeticTest(async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: sessionData } = await soul.post(
            `/realms/${realmId}/sessions`, {
        agentFingerprint: 'abcdef',
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
                agentFingerprint: 'uvwxyz',
                securityContext: 'authenticated:0',
                sessionTokens: sessionData.addTokens
            });

    t.is(accessAttemptData.resolution, 'invalid-with-prejudice');
}));
