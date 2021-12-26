'use strict';

const bodyParser = require('koa-bodyparser');

module.exports = {
    'GET /realms': {
        handler: async (ctx, next) => {
            const { after, docs } = await ctx.services.realms.byCreationTime.find(
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
            const realm =
                    await ctx.services.realms.fetchById(ctx.params.realmId);

            ctx.status = 200;
            ctx.body = {
                href: `${ctx.state.baseHref}/realms/${realm.id}`,
                ...realm
            };
        }
    },
    'POST /realms': {
        validator: {
            body: {
                friendlyName: check =>
                        check.optional(check.string({
                            minLength: 0,
                            maxLength: 100
                        })),
                userSpecifierSet: check =>
                        check.optional(check.array({
                            elements: check.string({
                                minLength: 1,
                                maxLength: 100
                            })
                        }))
            }
        },
        handler: async (ctx, next) => {
            const {
                friendlyName = '',
                userSpecifierSet = []
            } = ctx.request.body;

            const doc = await ctx.services.realms
                    .create(friendlyName, userSpecifierSet);
            doc.href = `${ctx.state.baseHref}/realms/${doc.id}`;

            ctx.response.set('Location', doc.href);
            ctx.response.set('Content-Location', doc.href);

            ctx.status = 201;
            ctx.body = doc;
        }
    }
};
