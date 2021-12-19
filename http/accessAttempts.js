'use strict';

const bodyParser = require('koa-bodyparser');
const errors = require('../standard-errors');
const Joi = require('joi');
const tokens = require('../utils/tokens');

const { DateTime } = require('luxon');

module.exports = router => {
    router.post(
            '/realms/:realmId/accessAttempts', bodyParser(),
            async (ctx, next) => {

        Joi.assert({
            body: ctx.body
        }, Joi.object({
            body: {
                sessionToken: Joi.string().min(0).max(500).optional()
            }
        }).unknown());

        if (ctx.request.body.sessionToken) {
            let decodedSessionToken;
            let session;

            try {
                decodedSessionToken = tokens.decode(
                        ctx.request.body.sessionToken, ctx.state.config);

                session = await ctx.services.sessions.validateSessionToken(
                        ctx.params.realmId, decodedSessionToken.sessionId,
                        decodedSessionToken.eraCredentials,
                        ctx.params.agentFingerprint, ctx.state.config);
            }
            catch (e) {
                if (e.code !== 'MALFORMED_TOKEN') {
                    throw e.unexpectedError(e);
                }
            }

            ctx.status = 200;
            ctx.body = {
                resolution: 'valid',
                session: {
                    createdAt: session.createdAt,
                    currentEraStartedAt: session.currentEraStartedAt,
                    currentEraNumber: session.currentEraNumber,
                    href: `${ctx.state.baseHref}`
                            + `/realms/${ctx.params.realmId}`
                            + `/sessions/${session.id}`,
                    id: session.id,
                    lastUsedAt: session.lastUsedAt,
                    realmId: session.realmId,
                    userId: session.userId
                }
            };

            if (session.nextEraCredentials) {
                ctx.body.nextSessionToken = tokens.encode(
                        session.id, session.eraCredentials, ctx.state.config);
            }
        }
        else {
            throw new Error();
        }
    });

    router.post('/realms', bodyParser(), async (ctx, next) => {
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
    });
};
