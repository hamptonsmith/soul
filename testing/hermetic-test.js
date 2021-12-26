'use strict';

const axios = require('axios');
const buildInterceptableMongo = require('./utils/interceptable-mongo');
const CSON = require('cson-parser');
const FakeErrorReporter = require('./fakes/fake-error-reporter');
const fakeScheduler = require('./fakes/fake-scheduler');
const http = require('http');
const ms = require('ms');
const soul = require('../app');

const { MongoClient } = require('mongodb');

module.exports = (...args) => async t => {
    const fn = args.find(a => typeof a === 'function');
    const opts = args.find(a => typeof a === 'object') || {};

    const testId = randomTestId();

    const config = {
        "mongodb": {
            "dbName": `testdb-${testId}`,
            "uri": `mongodb://localhost:${process.env.MONGOD_PORT}`
        },
        "port": 0,

        ...opts.config
    };

    const nower = fakeNower();

    // This is a client for the service to use and close. We'll make our own
    // later for testing business.
    const iMongo = buildInterceptableMongo();
    const iDbClient = (await iMongo.MongoClient.connect(config.mongodb.uri))
            .db(config.mongodb.dbName);

    iDbClient.addInterceptor = iMongo.addInterceptor.bind(iMongo);

    let server;
    try {
        const runtimeDeps = {
            errorReporter: new FakeErrorReporter(t.log),
            log: t.log,
            mongoConnect: uri => iMongo.MongoClient.connect(uri),
            nower,
            schedule: fakeScheduler()
        }

        server = await soul(
                [`data:text/plain,${CSON.stringify(config)}`], runtimeDeps);

        await fn(t, {
            baseHref: server.url,
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
