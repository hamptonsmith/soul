'use strict';

const bodyParser = require('koa-bodyparser');
const CSON = require('cson-parser');
const fsLib = require('fs');
const http = require('http');
const Koa = require('koa');
const Mustache = require('mustache');
const realmsRoutes = require('./http/realms');
const RealmsService = require('./services/realms');
const Router = require('@koa/router');
const SbError = require('@shieldsbetter/sberror2');
const sessionsRoutes = require('./http/sessions');
const SessionsService = require('./services/sessions');
const slurpUri = require('@shieldsbetter/slurp-uri');
const util = require('util');

const { MongoClient } = require('mongodb');

class IncorrectUsage extends SbError {
    static messageTemplate = 'Incorrect usage: {{{message}}}';
}

class UnexpectedError extends SbError {
    static messageTemplate = 'Unexpected error: {{{message}}}';
}

const publicErrors = {};

module.exports = async (argv, {
    fs = fsLib,
    nower = Date.now
} = {}) => {
    if (argv.length > 1) {
        throw new IncorrectUsage({
            message: 'Too many parameters: ' + JSON.stringify(argv)
        });
    }

    const config = await loadConfig(argv[0]);

    const mongoClient = await MongoClient.connect(config.mongodb.uri);
    const dbClient = mongoClient.db(config.mongodb.dbName);
    const realms = new RealmsService(dbClient, nower);
    const sessions = new SessionsService(dbClient, nower);

    const services = {
        dbClient,
        realms,
        sessions
    };

    const app = new Koa();
    const router = new Router();

    app.use(async (ctx, next) => {
        ctx.request.id = randomRequestId();
        ctx.services = services;
        ctx.state.config = config;

        try {
            await next();

            if (typeof ctx.body === 'object') {
                ctx.body = JSON.stringify(ctx.body,
                    (key, value) => value instanceof Date
                            ? value.toISOString() : value);
                ctx.type = 'application/json';
            }
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

    realmsRoutes(router);
    sessionsRoutes(router);

    app
        .use(router.routes())
        .use(router.allowedMethods());

    const httpServer = http.createServer(app.callback());
    const port = await new Promise((resolve, reject) => {
        httpServer.listen(config.port || 0, err => {
            if (err) {
                reject(err);
            }
            else {
                resolve(httpServer.address().port);
            }
        })
    });

    config.publicBaseHref = Mustache.render(config.publicBaseHref, { port });

    return {
        async close() {
            await httpServer.close();
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
function randomRequestId() {
    const alpha = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let result = '';
    while (result.length < 8) {
        result += alpha.charAt(Math.floor(Math.random() * alpha.length));
    }

    return result;
}

if (require.main === module) {
    module.exports(process.argv.slice(2)).catch(e => {
        console.log(e);
        process.exit(1);
    });
}
