'use strict';

const accessAttemptsRoutes = require('./http/accessAttempts');
const bodyParser = require('koa-bodyparser');
const bs58 = require('bs58');
const clone = require('clone');
const ConsoleErrorReporter = require('./utils/ConsoleErrorReporter');
const CSON = require('cson-parser');
const crypto = require('crypto');
const deepequal = require('deepequal');
const defaultServiceConfig = require('./default-service-config');
const fsLib = require('fs');
const http = require('http');
const Koa = require('koa');
const lodash = require('lodash');
const Mustache = require('mustache');
const optimisticDocument = require('./utils/OptimisticDocument');
const realmsRoutes = require('./http/realms');
const RealmsService = require('./services/realms');
const Router = require('@koa/router');
const SbError = require('@shieldsbetter/sberror2');
const sessionsRoutes = require('./http/sessions');
const SessionsService = require('./services/sessions');
const slurpUri = require('@shieldsbetter/slurp-uri');
const UsersService = require('./services/users');
const util = require('util');

const { MongoClient } = require('mongodb');

class IncorrectUsage extends SbError {
    static messageTemplate = 'Incorrect usage: {{{message}}}';
}

class UnexpectedError extends SbError {
    static messageTemplate = 'Unexpected error: {{{message}}}';
}

const publicErrors = {};

module.exports = async (argv, runtimeOpts = {}) => {
    runtimeOpts = {
        errorReporter: new ConsoleErrorReporter(runtimeOpts.log || console.log),
        fs: fsLib,
        log: console.log,
        nower: Date.now,
        schedule: (ms, fn) => setTimeout(fn, ms),

        ...runtimeOpts
    };

    if (argv.length > 1) {
        throw new IncorrectUsage({
            message: 'Too many parameters: ' + JSON.stringify(argv)
        });
    }

    const serverConfig = await loadConfig(argv[0]);

    const mongoClient = await MongoClient.connect(serverConfig.mongodb.uri);
    const dbClient = mongoClient.db(serverConfig.mongodb.dbName);

    const serviceConfigDoc = await readyService(
            dbClient.collection('ServiceData'), runtimeOpts);

    let config = {
        ...serverConfig,
        ...defaultServiceConfig,
        ...serviceConfigDoc.getData()
    };

    serviceConfigDoc.on('documentChanged', () => {
        config = {
            ...serverConfig,
            ...defaultServiceConfig,
            ...serviceConfigDoc.getData()
        };
    });

    const realms = new RealmsService(dbClient, runtimeOpts);
    const sessions = new SessionsService(dbClient, runtimeOpts);

    const users = new UsersService(dbClient, realms, runtimeOpts);

    const services = {
        dbClient,
        realms,
        sessions,
        users
    };

    const app = new Koa();
    const router = new Router();

    app.use(async (ctx, next) => {
        ctx.request.id = randomId();
        ctx.services = services;

        // Note that because we reseat `config` when our underlying service
        // config changes, each request gets a consistent view of config.
        ctx.state.config = config;
        ctx.state.baseHref = `${ctx.protocol}://${ctx.host}`;

        try {
            await next();
        }
        catch (e) {
            console.log(
                    `\n===== Error handling request ${ctx.request.id} =====`);
            console.log(ctx.request.method, ctx.request.path);

            if (ctx._matchedRoute) {
                console.log('Matched route ' + ctx._matchedRoute);
            }
            else {
                console.log('Matched no route.');
            }

            console.log();
            console.log(e);
            while (e.cause) {
                console.log('Caused by: ', e.cause);
                e = e.cause;
            }

            console.log();

            if (publicErrors[e.code]) {
                ctx.body = {
                    code: e.code,
                    details: e.details,
                    message: e.message,
                    requestId: ctx.request.id
                };

                ctx.status = publicErrors[e.code];
            }
            else {
                ctx.body = {
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Internal server error.',
                    requestId: ctx.request.id
                };

                ctx.status = 500;
            }
        }
    });

    app.use(async (ctx, next) => {
        // While intuitively it would make no sense for Koa to try to parse
        // params in some "clever" way, I can't find that documented anywhere.
        // So until then, let's be paranoid.
        for (const [key, value] of Object.entries(ctx.params || {})) {
            if (typeof value !== 'string') {
                throw new Error(`URL param "${key}" wasn't a string? Was: `
                        + util.inspect(value, null, false, false));
            }
        }

        await next();
    });

    router.get('/health', async (ctx, next) => {
        ctx.status = 200;
        ctx.body = {
            status: 'ok'
        };
    });

    accessAttemptsRoutes(router);
    realmsRoutes(router);
    sessionsRoutes(router);

    app
        .use(router.routes())
        .use(router.allowedMethods());

    const httpServer = http.createServer(app.callback());
    const port = await new Promise((resolve, reject) => {
        httpServer.listen(serverConfig.port || 0, err => {
            if (err) {
                reject(err);
            }
            else {
                resolve(httpServer.address().port);
            }
        })
    });

    return {
        async close() {
            await httpServer.close();
            serviceConfigDoc.close();
            await mongoClient.close();
        },
        url: `http://localhost:${port}`
    };
};

async function loadConfig(uri) {
    let config;
    if (uri) {
        config = CSON.parse(await slurpUri(uri));
    }
    else {
        try {
            config = CSON.parse(fs.readFileSync('soulconfig.cson', 'utf8'));
        }
        catch (e) {
            if (e.code !== 'ENOENT') {
                throw new UnexpectedError(e, { message: e.message });
            }

            throw new IncorrectUsage({
                message: 'Must run in a directory with a `soulconfig.cson` or '
                        + 'pass a URI to such a config as the sole argument.'
            });
        }
    }

    return config;
}

// Doesn't need to be cryptographically secure.
function randomId(length = 8) {
    const alpha = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let result = '';
    while (result.length < length) {
        result += alpha.charAt(Math.floor(Math.random() * alpha.length));
    }

    return result;
}

async function readyService(serviceData, runtimeDeps) {
    const configDoc =
            await optimisticDocument(serviceData, 'config', {}, runtimeDeps);

    await configDoc.update(async config => {
        config.signingKeys = config.signingKeys || {};

        if (Object.keys(config.signingKeys).length === 0) {
            config.signingKeys['s1'] = {
                createdAt: new Date(runtimeDeps.nower()),
                default: true,
                secret: bs58.encode(crypto.randomBytes(32))
            };
        }
    });

    return configDoc;
}

if (require.main === module) {
    module.exports(process.argv.slice(2)).catch(e => {
        console.log(e);
        process.exit(1);
    });
}
