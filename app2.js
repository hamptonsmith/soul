'use strict';

const bodyParser = require('koa-bodyparser');
const Koa = require('koa');
const RealmsService = require('./services/realms');
const Router = require('@koa/router');
const SbError = require('@shieldsbetter/sberror2');
const slurpUri = require('@shieldsbetter/slurp-uri');

const { MongoClient } = require('mongodb');

class MissingEnvironmentVariable extends SbError {
    static messageTemplate = 'Required environment variable not set: {{name}}';
}

module.exports = async ({
    configUri = process.env.CONFIG_URI,
    nower = Date.now
} = {}) => {

    if (!configUri) {
        throw new MissingEnvironmentVariable({
            name: 'CONFIG_URI'
        });
    }

    const config = JSON.parse(await slurpUri(configUri));

    const mongoClient = await MongoClient.connect(config.mongodb.uri);
    const dbClient = mongoClient.db(config.mongodb.dbName);
    const realms = new RealmsService(dbClient, nower);

    const services = {
        dbClient,
        realms
    };

    const app = new Koa();
    const router = new Router();

    app.use(async (ctx, next) => {
        ctx.services = services;

        await next();
    });

    router.get('/realms', async (ctx, next) => {
        const { after, docs } = await ctx.services.realms.byCreationTime.find(
                {},
                ctx.query.after,
                ctx.query.limit !== undefined
                ? Number.parseInt(ctx.query.limit)
                : undefined);

        ctx.status = 200;
        ctx.body = {
            after,
            resources: docs.map(d => ({
                href: `${config.publicBaseHref}/realms/${d.id}`,

                ...d
            }))
        };
    });

    router.post('/realms', bodyParser(), async (ctx, next) => {
        const { friendlyName, owners, userSpecifierSet } = ctx.request.body;

        const doc = await ctx.services.realms
                .create(friendlyName, owners, userSpecifierSet);
        doc.href = `${config.publicBaseHref}/realms/${doc.id}`;

        ctx.response.set('Location', doc.href);
        ctx.response.set('Content-Location', doc.href);

        ctx.status = 201;
        ctx.body = doc;
    });

    app
        .use(router.routes())
        .use(router.allowedMethods());

    app.listen(8080);
};

module.exports().catch(e => {
    console.log(e);
    process.exit(1);
});
