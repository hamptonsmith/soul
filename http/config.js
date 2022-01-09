'use strict';

const bodyParser = require('koa-bodyparser');
const saneParseInt = require('parse-int');
const validateServiceConfig = require('../validate-service-config');

const { applyPatch } = require('fast-json-patch');

module.exports = {
    'GET /config': {
        handler: async (ctx, next) => {
            ctx.set('ETag', '' + ctx.state.services.leylineSettings
                    .getExplicitConfigVersionNumber());
            ctx.status = 200;
            ctx.body = {
                derived: ctx.state.serviceConfig,
                explicit: ctx.state.services.leylineSettings.getExplicitConfig()
            };
        }
    },
    'GET /config/derived': {
        handler: async (ctx, next) => {
            ctx.set('ETag', '' + ctx.state.services.leylineSettings
                    .getExplicitConfigVersionNumber());
            ctx.status = 200;
            ctx.body = ctx.state.serviceConfig;
        }
    },
    'GET /config/explicit': {
        handler: async (ctx, next) => {
            ctx.set('ETag', '' + ctx.state.services.leylineSettings
                    .getExplicitConfigVersionNumber());
            ctx.status = 200;
            ctx.body = ctx.state.services.leylineSettings.getExplicitConfig();
        }
    },
    'PATCH /config/explicit': {
        bodyparser: {},
        validator: check => ({
            body: [
                check.jsonPatch(),
                check.array({ maxLength: 100 })
            ],
            headers: {
                'content-type':
                        check.contentType('application/json-patch+json')
            }
        }),
        handler: async (ctx, next) => {
            const newConfig = await ctx.state.services.leylineSettings
                    .updateExplicitConfig(
                async currentConfig => {
                    applyPatch(currentConfig, ctx.request.body);
                    await validateServiceConfig(currentConfig);
                },
                undefined,
                desiredVersion(ctx.get('If-Match'))
            );

            ctx.status = 200;
            ctx.body = newConfig;
        }
    }
};

function desiredVersion(ifMatch) {
    if (ifMatch === '') {
        return undefined;
    }

    const parsedIfMatch = saneParseInt(ifMatch);

    if (parsedIfMatch === undefined) {
        return -1;
    }

    return parsedIfMatch;
}
