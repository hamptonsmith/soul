'use strict';

const axios = require('axios');
const buildInterceptableMongo = require('./utils/interceptable-mongo');
const buildFakeLogger = require('./fakes/fake-logger');
const crypto = require('crypto');
const CSON = require('cson-parser');
const FakeErrorReporter = require('./fakes/fake-error-reporter');
const fs = require('fs');
const fakeScheduler = require('./fakes/fake-scheduler');
const http = require('http');
const jsonwebtoken = require('jsonwebtoken');
const JwksClient = require('../utils/JwksClient');
const ms = require('ms');
const pathLib = require('path');
const pemToJwk = require('pem-jwk').pem2jwk;
const soul = require('../app');

const { MongoClient } = require('mongodb');

module.exports = (...args) => async t => {
    const fn = args.find(a => typeof a === 'function');
    const opts = args.find(a => typeof a === 'object') || {};

    const testId = randomTestId();

    let config = {
        mongodb: {
            dbName: `testdb-${testId}`,
            uri: `mongodb://localhost:${process.env.MONGOD_PORT}`
        },
        port: 0,
    };

    if (opts.config) {
        if (typeof opts.config === 'function') {
            config = {
                ...config,
                ...opts.config(config)
            };
        }
        else {
            config = {
                ...config,
                ...opts.config
            }
        }
    }

    const nower = fakeNower();
    let jwksClient;

    // This is a client for the service to use and close. We'll make our own
    // later for test framework business.
    const iMongo = buildInterceptableMongo();
    const iDbClient = (await iMongo.MongoClient.connect(config.mongodb.uri))
            .db(config.mongodb.dbName);

    iDbClient.addInterceptor = iMongo.addInterceptor.bind(iMongo);

    let server;

    async function buildJwt(issuer, alg, kid, payload) {
        if (!jwksClient) {
            jwksClient = new JwksClient(
                    server.services.leylineSettings, { nower });
        }

        const jwk = await jwksClient.getJwk(issuer, alg, kid);

        const signingOpts = {
            algorithm: alg,
            audience: server.services.leylineSettings.getConfig().audienceId,
            keyid: kid
        };

        if (!payload.iss) {
            // jsonwebtoken distinguishes `undefined` from not set,
            // naturally.
            signingOpts.issuer = issuer;
        }

        let jwt;
        if (alg === 'HS256') {
            jwt = jsonwebtoken.sign({ iat: nower(), ...payload },
                    Buffer.from(jwk.k, 'base64url'),
                    signingOpts);
        }
        else if (alg === 'RS256') {
            jwt = jsonwebtoken.sign({ iat: nower(), ...payload },
                    jwk.cheatPrivateKey,
                    signingOpts);
        }
        else {
            throw new Error('Can\'t sign with alg ' + alg + ' in tests.');
        }

        return jwt;
    }

    try {
        const runtimeDeps = {
            errorReporter: new FakeErrorReporter(t.log),
            log: buildFakeLogger(t.log),
            mongoConnect: (uri, opts) => iMongo.MongoClient.connect(uri, opts),
            nower,
            schedule: fakeScheduler()
        }

        server = await soul(
                [`data:text/plain,${encodeURIComponent(CSON.stringify(config))}`],
                runtimeDeps);

        await axios.patch(`${server.url}/config/explicit`,
                [{
                    op: 'add',
                    path: '/jwks',
                    value: {
                        'https://local.literal.key.com': {
                            literal: {
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
                            }
                        }
                    }
                }],
                {
                    headers: {
                        'Content-Type': 'application/json-patch+json'
                    }
                });

        await fn(t, {
            baseHref: server.url,
            buildJwt,
            config,
            dbClient: iDbClient,
            doBestEffort: async (name, pr) => await pr,
            soul: axios.create({ baseURL: server.url }),

            ...runtimeDeps
        });
    }
    catch (e) {
        if (e.isAxiosError) {
            t.log('Axios error. You sent: ' + e.config.method.toUpperCase()
                    + ' ' + e.config.baseURL + e.config.url);
            t.log(e.config.headers);
            t.log(e.config.data);

            t.log('');
            t.log('You got: ' + e.response.status + ' '
                    + e.response.statusTest);
            t.log(e.response.headers);
            t.log(e.response.data);

            t.fail(e.message);
        }

        throw e;
    }
    finally {
        if (server) {
            await server.close();
        }

        const testingMongoClient =
                await MongoClient.connect(config.mongodb.uri);

        await testingMongoClient.db(config.mongodb.dbName).dropDatabase();
        await testingMongoClient.close();
    }
};

async function makeListen(s) {
    return await new Promise((resolve, reject) => httpServer.listen(0, err => {
        if (err) { reject(err); }
        else { port = httpServer.address().port; }
    }));
}

// Doesn't need to be cryptographically secure.
function randomTestId() {
    const alpha = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let result = '';
    while (result.length < 10) {
        result += alpha.charAt(Math.floor(Math.random() * alpha.length));
    }

    return result;
}

function fakeNower() {
    let now = new Date('2020-01-01T12:00:00Z').valueOf();

    const nower = () => now;
    nower.advance = t => now = new Date(now.valueOf() + ms(t));
    nower.setNow = n => now = n;

    return nower;
}
