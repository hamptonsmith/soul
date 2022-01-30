'use strict';

const axios = require('axios');
const bs58 = require('bs58');
const crypto = require('crypto');
const defaultConfig = require('../../default-service-config');
const fs = require('fs');
const hermeticTest = require('../hermetic-test');
const jsonpointer = require('json-pointer');
const jsonwebtoken = require('jsonwebtoken');
const LinkHeader = require('http-link-header');
const pathLib = require('path');
const pemToJwk = require('pem-jwk').pem2jwk;
const test = require('ava');

const rsaPrivateKeyPem = fs.readFileSync(
        pathLib.join(__dirname, '..', 'fixtures', 'rsa.priv.pem'), 'utf8');

const rsaPublicKeyJwt = pemToJwk(fs.readFileSync(
        pathLib.join(__dirname, '..', 'fixtures', 'rsa.pub.pem'), 'utf8'));

test('dev mechanism', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: sessionData } = await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`, {
        mechanism: 'dev',
        jwtPayload: {
            iat: nower(),
            iss: 'http://me.com',
            sub: 'user123'
        }
    });

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/accessAttempts`,
            {
                sessionTokens: sessionData.addTokens
            });

    t.deepEqual(
            accessAttemptData.sessions.map(s => s.id),
            [sessionData.sessions[0].id]);
}));

test('idToken mechanism', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: sessionData } = await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`, {
        mechanism: 'idToken',
        token: await buildJwt(
                'https://local.literal.key.com',
                'HS256', 'key1', {
                    sub: 'testuser1'
                })
    });

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/accessAttempts`,
            {
                sessionTokens: sessionData.addTokens
            });

    t.deepEqual(
            accessAttemptData.sessions.map(s => s.id),
            [sessionData.sessions[0].id]);
}));

test('anonymous mechanism', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: sessionData } = await soul.post(
            `/realms/${realmId}/securityContexts/anonymous/sessions`, {
        mechanism: 'anonymous'
    });

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/securityContexts/anonymous/accessAttempts`,
            {
                sessionTokens: sessionData.addTokens
            });

    t.deepEqual(
            accessAttemptData.sessions.map(s => s.id),
            [sessionData.sessions[0].id]);
}));

test('rsa key', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    await soul.patch('/config/explicit', [
        {
            op: 'add',
            path: jsonpointer.compile([
                'jwks', 'https://local.literal.key.com', 'literal', 'keys', '-'
            ]),
            value: {
                ...rsaPublicKeyJwt,

                alg: 'RS256',
                kid: 'key2',
                use: 'sig',

                // This just makes life easy on our signing
                // helper function function.
                cheatPrivateKey: rsaPrivateKeyPem
            }
        }
    ],
    {
        headers: {
            'Content-Type': 'application/json-patch+json'
        }
    });

    const { data: sessionData } = await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`, {
        mechanism: 'idToken',
        token: await buildJwt(
                'https://local.literal.key.com',
                'RS256', 'key2', {
                    sub: 'testuser1'
                })
    });

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/accessAttempts`,
            {
                sessionTokens: sessionData.addTokens
            });

    t.deepEqual(
            accessAttemptData.sessions.map(s => s.id),
            [sessionData.sessions[0].id]);
}));

test('uri jwks', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    await soul.patch('/config/explicit', [
        {
            op: 'add',
            path: jsonpointer.compile([ 'jwks', 'https://uri.key.com' ]),
            value: {
                uri: 'data:application/json,'
                        + encodeURIComponent(JSON.stringify({
                            keys: [
                                {
                                    alg: 'HS256',
                                    k: crypto.randomBytes(32)
                                            .toString('base64url'),
                                    kid: 'key1',
                                    kty: 'oct',
                                    use: 'sig'
                                }
                            ]
                        }))
            }
        }
    ],
    {
        headers: {
            'Content-Type': 'application/json-patch+json'
        }
    });

    const { data: sessionData } = await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`, {
        mechanism: 'idToken',
        token: await buildJwt(
                'https://uri.key.com',
                'HS256', 'key1', {
                    sub: 'testuser1'
                })
    });

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/accessAttempts`,
            {
                sessionTokens: sessionData.addTokens
            });

    t.deepEqual(
            accessAttemptData.sessions.map(s => s.id),
            [sessionData.sessions[0].id]);
}));

test('issuer w/ malicious name', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const error = await t.throwsAsync(soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`,
            {
                mechanism: 'idToken',
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
            `/realms/${realmId}/securityContexts/authenticated/sessions`,
            {
                mechanism: 'idToken',
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

test('no such key for issuer', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {
    const { data: { id: realmId }} = await soul.post('/realms');

    const error = await t.throwsAsync(soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`,
            {
                mechanism: 'idToken',
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

test('unknown kty', hermeticTest(async (t, { buildJwt, soul, nower }) => {
    const { data: { id: realmId }} = await soul.post('/realms');

    await soul.patch('/config/explicit', [
        {
            op: 'add',
            path: jsonpointer.compile(['jwks', 'https://weirdkey.com']),
            value: {
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
            }
        }
    ],
    {
        headers: {
            'Content-Type': 'application/json-patch+json'
        }
    });

    const error = await t.throwsAsync(soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`,
            {
                mechanism: 'idToken',
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
            `/realms/${realmId}/securityContexts/authenticated/sessions`, {
        mechanism: 'dev',
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
            `/realms/${realmId}/securityContexts/authenticated/accessAttempts`,
            {
                sessionTokens: sessionData.addTokens
            });

    t.is(accessAttemptData.sessions.length, 0);
    t.deepEqual(accessAttemptData.retireTokens, sessionData.addTokens);
}));

test('security contexts can have absolute expirations', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: sessionData } = await soul.post(
            `/realms/${realmId}/securityContexts/secure/sessions`, {
        mechanism: 'dev',
        jwtPayload: {
            iat: nower(),
            iss: 'http://me.com',
            sub: 'user123'
        }
    });

    nower.advance(defaultConfig.defaultRealmSecurityContexts.secure
            .sessionOptions.absoluteExpirationDuration);
    nower.advance('1s');

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/securityContexts/secure/accessAttempts`,
            {
                sessionTokens: sessionData.addTokens
            });

    t.is(accessAttemptData.sessions.length, 0);
    t.deepEqual(accessAttemptData.retireTokens, sessionData.addTokens);
}));

test('valid credentials but wrong context', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: sessionData } = await soul.post(
            `/realms/${realmId}/securityContexts/secure/sessions`, {
        mechanism: 'dev',
        jwtPayload: {
            iat: nower(),
            iss: 'http://me.com',
            sub: 'user123'
        }
    });

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/accessAttempts`,
            {
                sessionTokens: sessionData.addTokens
            });

    t.is(accessAttemptData.sessions.length, 0);
    t.deepEqual(accessAttemptData.retireTokens, []);
}));

test('token w/ unknown protocol', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/accessAttempts`,
            {
                sessionTokens: [bs58.encode(Buffer.from([1]))]
            });

    t.is(accessAttemptData.sessions.length, 0);
    t.deepEqual(accessAttemptData.retireTokens, []);
}));

test('token w/ bad signature', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/accessAttempts`,
            {
                sessionTokens: [
                    // This buffer is full of zeros and thus it has the right
                    // protocol (0), but a nonsense signature (all zeroes) for
                    // its data (seven zeroes)
                    bs58.encode(Buffer.alloc(40))
                ]
            });

    t.is(accessAttemptData.sessions.length, 0);
    t.deepEqual(accessAttemptData.retireTokens, []);
}));

test('bad token encoding ignores token', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/accessAttempts`,
            {
                sessionTokens: [
                    // This isn't base58!
                    '!@#$%^&*'
                ]
            });

    t.is(accessAttemptData.sessions.length, 0);
    t.deepEqual(accessAttemptData.retireTokens, []);
}));

test('same agent fingerprint succeeds', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: sessionData } = await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`, {
        agentFingerprint: 'abcdef',
        mechanism: 'dev',
        jwtPayload: {
            iat: nower(),
            iss: 'http://me.com',
            sub: 'user123'
        }
    });

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/accessAttempts`,
            {
                agentFingerprint: 'abcdef',
                sessionTokens: sessionData.addTokens
            });

    t.deepEqual(
            accessAttemptData.sessions.map(s => s.id),
            [sessionData.sessions[0].id]);
}));

test('different agent fingerprint invalidates session w/ prejudice',
        hermeticTest(async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: sessionData } = await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`, {
        agentFingerprint: 'abcdef',
        mechanism: 'dev',
        jwtPayload: {
            iat: nower(),
            iss: 'http://me.com',
            sub: 'user123'
        }
    });

    const { data: accessAttemptData } = await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/accessAttempts`,
            {
                agentFingerprint: 'uvwxyz',
                sessionTokens: sessionData.addTokens
            });

    t.is(accessAttemptData.sessions.length, 0);
    t.deepEqual(accessAttemptData.retireTokens, sessionData.addTokens);
    t.deepEqual(accessAttemptData.suspiciousTokens, sessionData.addTokens);
    t.deepEqual(accessAttemptData.suspiciousSessionIds,
            [sessionData.sessions[0].id]);
}));

test('compile-time error in precondition', hermeticTest(
        async (t, { baseHref, soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms', {
        securityContexts: {
            foo: { precondition: '5.nine!@#$' }
        }
    });

    const error = await t.throwsAsync(soul.post(
            `/realms/${realmId}/securityContexts/foo/sessions`, {
        agentFingerprint: 'abcdef',
        mechanism: 'dev',
        jwtPayload: {
            iat: nower(),
            iss: 'http://me.com',
            sub: 'user123'
        }
    }));

    t.is(error.response.status, 403);
    t.is(error.response.data.code, 'INVALID_CREDENTIALS');
}));

test('run-time error in precondition', hermeticTest(
        async (t, { baseHref, soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms', {
        securityContexts: {
            foo: { precondition: '"a" + "b"' }
        }
    });

    const error = await t.throwsAsync(soul.post(
            `/realms/${realmId}/securityContexts/foo/sessions`, {
        agentFingerprint: 'abcdef',
        mechanism: 'dev',
        jwtPayload: {
            iat: nower(),
            iss: 'http://me.com',
            sub: 'user123'
        }
    }));

    t.is(error.response.status, 403);
    t.is(error.response.data.code, 'INVALID_CREDENTIALS');
}));

test('jwt claims too big', hermeticTest(
        async (t, { baseHref, soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const error = await t.throwsAsync(soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`, {
        mechanism: 'dev',
        jwtPayload: {
            iat: nower(),
            iss: 'http://me.com',
            sub: 'user123',
            big: stringOfLength(3000)
        }
    }));

    t.is(error.response.status, 400);
    t.is(error.response.data.code, 'VALIDATION_ERROR');
}));

test('non-existent security context on create', hermeticTest(
        async (t, { baseHref, soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const error = await t.throwsAsync(soul.post(
            `/realms/${realmId}/securityContexts/sillyname/sessions`, {
        mechanism: 'dev',
        jwtPayload: {
            iat: nower(),
            iss: 'http://me.com',
            sub: 'user123'
        }
    }));

    t.is(error.response.status, 404);
    t.is(error.response.data.code, 'NO_SUCH_SECURITY_CONTEXT');
}));

test('non-existent security context on access check', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const error = await t.throwsAsync(soul.post(
            `/realms/${realmId}/securityContexts/sillyname/accessAttempts`,
            {
                sessionTokens: ['blah']
            }));

    t.is(error.response.status, 404);
    t.is(error.response.data.code, 'NO_SUCH_SECURITY_CONTEXT');
}));

test('session list', hermeticTest(
        async (t, { baseHref, soul, nower }) => {

    const { data: { id: realmId1 }} = await soul.post('/realms');
    const { data: { id: realmId2 }} = await soul.post('/realms');

    await soul.post(
            `/realms/${realmId1}/securityContexts/authenticated/sessions`, {
        mechanism: 'dev',
        jwtPayload: {
            iat: nower(),
            iss: 'http://me.com',
            sub: 'user123'
        }
    });

    for (let i = 0; i < 32; i++) {
        await soul.post(
                `/realms/${realmId2}/securityContexts/authenticated/sessions`, {
            mechanism: 'dev',
            jwtPayload: {
                iat: nower(),
                iss: 'http://me.com',
                sub: 'user123'
            }
        });
    }

    const retrievedSessions = [];
    let link = new LinkHeader();
    link.set({
        rel: 'next',
        uri: `${baseHref}/realms/${realmId2}/sessions?limit=10`
    });

    while(link.has('next')) {
        const response = await axios.get(link.get('next')[0].uri);
        for (const d of response.data) {
            retrievedSessions.push(d);
        }

        link = LinkHeader.parse(response.headers.link || '');
    }

    t.is(retrievedSessions.length, 32);
}));

function stringOfLength(n) {
    let result = '';
    while (result.length < n) {
        result += 'a';
    }
    return result;
}
