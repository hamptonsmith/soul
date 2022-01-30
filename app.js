'use strict';

const accessAttemptsRoutes = require('./http/accessAttempts');
const bodyParser = require('koa-bodyparser');
const bs58 = require('bs58');
const clone = require('clone');
const configRoutes = require('./http/config');
const ConsoleErrorReporter = require('./utils/ConsoleErrorReporter');
const CSON = require('cson-parser');
const crypto = require('crypto');
const deepequal = require('deepequal');
const fsLib = require('fs');
const http = require('http');
const JsonataService = require('./services/jsonata');
const JwtsService = require('./services/jwts');
const Koa = require('koa');
const LeylineSettingsService = require('./services/LeylineSettingsService');
const lodash = require('lodash');
const metricsRoutes = require('./http/metrics');
const MetricsService = require('./services/MetricsService');
const Mustache = require('mustache');
const optimisticDocument = require('./utils/OptimisticDocument');
const realmsRoutes = require('./http/realms');
const RealmsService = require('./services/realms');
const Router = require('@koa/router');
const SbError = require('@shieldsbetter/sberror2');
const sessionsRoutes = require('./http/sessions');
const SessionsService = require('./services/sessions');
const slurpUri = require('@shieldsbetter/slurp-uri');
const standardEndpoints = require('./utils/standard-endpoints');
const util = require('util');
const validate = require('./utils/validator');

const { MongoClient } = require('mongodb');

class IncorrectUsage extends SbError {
    static messageTemplate = 'Incorrect usage: {{{message}}}';
}

class UnexpectedError extends SbError {
    static messageTemplate = 'Unexpected error: {{{message}}}';
}

const publicErrors = {
    INVALID_CREDENTIALS: 403,
    NO_SUCH_KEY: 401,
    NO_SUCH_REALM: 404,
    NO_SUCH_SECURITY_CONTEXT: 404,
    NOT_AUTHENTICATED: 401,
    UNACCEPTABLE_JWT: 401,
    UNFAMILIAR_AUTHORITY: 401,
    VALIDATION_ERROR: 400,
    VERSION_PRECONDITION_FAILED: 412
};

module.exports = async (argv, runtimeOpts = {}) => {
    runtimeOpts = {
        doBestEffort: (name, pr) => {
            pr.catch(e => {
                this.errorReporter.warning(
                    'Error during best effort action: ' + name, e)
            });
        },
        errorReporter:
                new ConsoleErrorReporter(runtimeOpts.log || ctx.state.log),
        fs: fsLib,
        log: console.log,
        mongoConnect: MongoClient.connect,
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

    const mongoClient = await runtimeOpts.mongoConnect(
            serverConfig.mongodb.uri, { ignoreUndefined: true });
    const dbClient = mongoClient.db(serverConfig.mongodb.dbName);

    const serviceConfigDoc = await readyService(
            dbClient.collection('ServiceData'), runtimeOpts);

    const jsonata = new JsonataService(runtimeOpts);
    const leylineSettings = new LeylineSettingsService(serviceConfigDoc);
    const metrics = new MetricsService();

    const realms = new RealmsService(dbClient, jsonata, runtimeOpts);
    const jwts = new JwtsService(leylineSettings, metrics, runtimeOpts);
    const sessions = new SessionsService(
                dbClient, jsonata, leylineSettings, realms, runtimeOpts);

    const services = {
        dbClient,
        jsonata,
        jwts,
        leylineSettings,
        metrics,
        realms,
        sessions
    };

    const app = new Koa();
    const router = new Router();

    app.use(async (ctx, next) => {
        ctx.request.id = randomId();

        ctx.state.baseHref = `${ctx.protocol}://${ctx.host}`;
        ctx.state.serverConfig = serverConfig;
        ctx.state.serviceConfig = leylineSettings.getConfig();
        ctx.state.services = services;

        Object.assign(ctx.state, runtimeOpts);

        try {
            await next();
        }
        catch (e) {
            ctx.state.log(
                    `\n===== Error handling request ${ctx.request.id} =====`);
            ctx.state.log(ctx.request.method, ctx.request.path);

            if (ctx._matchedRoute) {
                ctx.state.log('Matched route ' + ctx._matchedRoute);
            }
            else {
                ctx.state.log('Matched no route.');
            }

            let bestError = e;

            ctx.state.log();
            ctx.state.log(errorStack(e));
            while (e.cause) {
                ctx.state.log('Caused by: ', errorStack(e.cause));
                e = e.cause;

                if (e instanceof validate.ValidationError) {
                    bestError = e;
                }
            }

            ctx.state.log();

            if (publicErrors[bestError.code]) {
                ctx.body = {
                    code: bestError.code,
                    details: bestError.details,
                    message: errorMessage(bestError),
                    requestId: ctx.request.id
                };

                if (typeof publicErrors[bestError.code] === 'number') {
                    ctx.status = publicErrors[bestError.code];
                }
                else {
                    ctx.status = 500;
                    publicErrors[e.code](bestError, ctx);
                }
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

    await standardEndpoints(router, accessAttemptsRoutes);
    await standardEndpoints(router, configRoutes);
    await standardEndpoints(router, metricsRoutes);
    await standardEndpoints(router, realmsRoutes);
    await standardEndpoints(router, sessionsRoutes);

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
        services,
        url: `http://localhost:${port}`
    };
};

function errorMessage(e) {
    if (e instanceof validate.ValidationError) {
        let valString = util.inspect(e.actualValue, false, null);

        if (valString.length > 100) {
            valString = valString.substring(0, 97) + '...';
        }

        return e.path.join('.') + ' is invalid: ' + e.message + '. Got: '
                + valString;
    }
    else {
        return e.message;
    }
}

function errorStack(e) {
    const renderedMessage = errorMessage(e);

    const target = randomId(100);

    const oldMessage = e.message;
    e.message = target;

    const result = e.stack.replace(target, renderedMessage);
    e.message = oldMessage;

    return result;
}

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
        if (!config.signingSecret) {
            config.signingSecret = bs58.encode(crypto.randomBytes(32));
        }

        if (!config.audienceId) {
            config.audienceId = 'aud_' + bs58.encode(crypto.randomBytes(32));
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
