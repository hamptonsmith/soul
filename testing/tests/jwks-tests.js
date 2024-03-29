'use strict';

const crypto = require('crypto');
const hermeticTest = require('../hermetic-test');
const jsonpointer = require('json-pointer');
const test = require('ava');

test('only refresh uri JWKS every 30s', hermeticTest(
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
                                },
                                {
                                    alg: 'HS256',
                                    k: crypto.randomBytes(32)
                                            .toString('base64url'),
                                    kid: 'key2',
                                    kty: 'oct',
                                    use: 'sig'
                                },
                                {
                                    alg: 'HS256',
                                    k: crypto.randomBytes(32)
                                            .toString('base64url'),
                                    kid: 'key3',
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

    t.is((await soul.get('/metrics')).data.issuerJwksRefresh, undefined);

    // First request against the issuer triggers a refresh from the JWKS uri.
    await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`, {
        mechanism: 'idToken',
        token: await buildJwt(
                'https://uri.key.com',
                'HS256', 'key1', {
                    sub: 'testuser1'
                })
    });

    t.is((await soul.get('/metrics')).data.issuerJwksRefresh, 1);

    // Second request doesn't trigger a refresh, even with an uncached key,
    // because we will only refresh once every 30 seconds.
    await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`, {
        mechanism: 'idToken',
        token: await buildJwt(
                'https://uri.key.com',
                'HS256', 'key2', {
                    sub: 'testuser1'
                })
    });

    t.is((await soul.get('/metrics')).data.issuerJwksRefresh, 1);

    // Third request WILL trigger a refresh for an uncached key, if 30 seconds
    // has passed.
    nower.advance('31s');

    await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`, {
        mechanism: 'idToken',
        token: await buildJwt(
                'https://uri.key.com',
                'HS256', 'key3', {
                    sub: 'testuser1'
                })
    });

    t.is((await soul.get('/metrics')).data.issuerJwksRefresh, 2);

    // Unrelated, but let's go ahead and check this while we're here...
    t.is((await soul.get('/metrics')).data.jwkCacheMiss, 3);
}));

test('JWK\'s are cached', hermeticTest(
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

    t.is((await soul.get('/metrics')).data.jwkCacheMiss, undefined);

    // First request against the issuer is necessarily a cache miss.
    await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`, {
        mechanism: 'idToken',
        token: await buildJwt(
                'https://uri.key.com',
                'HS256', 'key1', {
                    sub: 'testuser1'
                })
    });

    t.is((await soul.get('/metrics')).data.jwkCacheMiss, 1);

    // Second request against the same key should be cached.
    await soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`, {
        mechanism: 'idToken',
        token: await buildJwt(
                'https://uri.key.com',
                'HS256', 'key1', {
                    sub: 'testuser1'
                })
    });

    t.is((await soul.get('/metrics')).data.jwkCacheMiss, 1);
}));

test('expired JWT', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const idToken = await buildJwt(
            'https://local.literal.key.com',
            'HS256', 'key1', {
                exp: Math.floor(nower() / 1000),
                sub: 'testuser1'
            });

    nower.advance('1m');

    const error = await t.throwsAsync(soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`, {
        mechanism: 'idToken',
        token: idToken
    }));

    t.is(error.response.data.code, 'UNACCEPTABLE_JWT');
}));

test('no issuer', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const idToken = await buildJwt(
            'https://local.literal.key.com',
            'HS256', 'key1', {
                sub: 'testuser1'
            }, { noIssuer: true });

    const error = await t.throwsAsync(soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`, {
        mechanism: 'idToken',
        token: idToken
    }));

    t.is(error.response.data.code, 'UNACCEPTABLE_JWT');
}));

test('no subject', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const idToken = await buildJwt(
            'https://local.literal.key.com',
            'HS256', 'key1', {});

    const error = await t.throwsAsync(soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`, {
        mechanism: 'idToken',
        token: idToken
    }));

    console.log(error);

    t.is(error.response.data.code, 'UNACCEPTABLE_JWT');
}));

test('no `alg` header', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const idToken = Buffer.from(JSON.stringify({
        kid: 'key1'
    })).toString('base64url') + '.'
    + Buffer.from(JSON.stringify({ iss: 'ladedah' })).toString('base64url')
    + '.' + Buffer.from('signature!').toString('base64url');

    const error = await t.throwsAsync(soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`, {
        mechanism: 'idToken',
        token: idToken
    }));

    t.is(error.response.data.code, 'UNACCEPTABLE_JWT');
}));

test('no `kid` header', hermeticTest(
        async (t, { buildJwt, soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const idToken = Buffer.from(JSON.stringify({
        alg: 'HS256'
    })).toString('base64url') + '.'
    + Buffer.from(JSON.stringify({ iss: 'ladedah' })).toString('base64url')
    + '.' + Buffer.from('signature!').toString('base64url');

    const error = await t.throwsAsync(soul.post(
            `/realms/${realmId}/securityContexts/authenticated/sessions`, {
        mechanism: 'idToken',
        token: idToken
    }));

    t.is(error.response.data.code, 'UNACCEPTABLE_JWT');
}));
