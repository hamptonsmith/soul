'use strict';

const bodyParser = require('koa-bodyparser');

module.exports = {
    'GET /realms': {
        handler: async (ctx, next) => {
            const { after, docs } =
                    await ctx.state.services.realms.byCreationTime.find(
                        {},
                        ctx.query.after,
                        ctx.query.limit !== undefined
                                ? Number.parseInt(ctx.query.limit)
                                : undefined);

            ctx.status = 200;
            ctx.body = {
                continueToken: after,
                continueLink: after ? `${ctx.state.baseHref}/realms`
                        + `?after=${after}&limit=${docs.length}` : undefined,
                resources: docs.map(d => ({
                    href: `${ctx.state.baseHref}/realms/${d.id}`,

                    ...d
                }))
            };
        }
    },
    'GET /realms/:realmId': {
        handler: async (ctx, next) => {
            const realm = await ctx.state.services.realms.fetchById(
                    ctx.params.realmId);

            ctx.status = 200;
            ctx.body = {
                href: `${ctx.state.baseHref}/realms/${realm.id}`,
                ...realm
            };
        }
    },
    'POST /realms': {
        bodyparser: {},
        validator: check => ({
            // A validator instructs standard-middleware to install a body
            // parser, but there's no validation to do here beyond what will be
            // done by the service.
            body: check.object({})
        }),
        handler: async (ctx, next) => {
            const {
                friendlyName = '',
                securityContexts =
                        ctx.state.serviceConfig.defaultRealmSecurityContexts
            } = ctx.request.body;

            const doc = await ctx.state.services.realms.create(
                    friendlyName, securityContexts);
            doc.href = `${ctx.state.baseHref}/realms/${doc.id}`;

            ctx.response.set('Location', doc.href);
            ctx.response.set('Content-Location', doc.href);

            ctx.status = 201;
            ctx.body = doc;
        }
    }
};
