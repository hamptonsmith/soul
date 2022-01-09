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
            `/realms/${realmId}/sessions`, {
        mechanism: 'idToken',
        securityContext: 'authenticated',
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
            `/realms/${realmId}/sessions`, {
        mechanism: 'idToken',
        securityContext: 'authenticated',
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
            `/realms/${realmId}/sessions`, {
        mechanism: 'idToken',
        securityContext: 'authenticated',
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
            `/realms/${realmId}/sessions`, {
        mechanism: 'idToken',
        securityContext: 'authenticated',
        token: await buildJwt(
                'https://uri.key.com',
                'HS256', 'key1', {
                    sub: 'testuser1'
                })
    });

    t.is((await soul.get('/metrics')).data.jwkCacheMiss, 1);

    // Second request against the same key should be cached.
    await soul.post(
            `/realms/${realmId}/sessions`, {
        mechanism: 'idToken',
        securityContext: 'authenticated',
        token: await buildJwt(
                'https://uri.key.com',
                'HS256', 'key1', {
                    sub: 'testuser1'
                })
    });

    t.is((await soul.get('/metrics')).data.jwkCacheMiss, 1);
}));
