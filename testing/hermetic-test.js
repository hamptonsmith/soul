'use strict';

const axios = require('axios');
const CSON = require('cson-parser');
const http = require('http');
const soul = require('../app2.js');

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

    let server;
    try {
        server = await soul(
            [`data:text/plain,${CSON.stringify(config)}`],
            { nower }
        );

        await fn(t, {
            baseHref: server.url,
            config,
            doBestEffort: async pr => await pr,
            nower,
            soul: axios.create({ baseURL: server.url })
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

        const dbClient = await MongoClient.connect(config.mongodb.uri);
        await dbClient.db(config.mongodb.dbName).dropDatabase();
        await dbClient.close();
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
    nower.setNow = n => now = n;

    return nower;
}
