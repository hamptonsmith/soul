'use strict';

const bodyParser = require('koa-bodyparser');
const errors = require('../standard-errors');
const lodash = require('lodash');
const schema = require('../utils/validator');
const tokens = require('../utils/tokens');

const { DateTime } = require('luxon');

module.exports = {
    'POST /realms/:realmId/accessAttempts': {
        validator: {
            body: {
                sessionToken: check => check.string({
                    minLength: 10,
                    maxLength: 500
                })
            }
        },
        handler: async (ctx, next) => {
            if (ctx.request.body.sessionToken) {
                let decodedSessionToken;
                let session;
                let error;

                try {
                    decodedSessionToken = tokens.decode(
                            ctx.request.body.sessionToken, ctx.state.config);

                    session = await ctx.services.sessions.validateSessionToken(
                            ctx.params.realmId, decodedSessionToken.sessionId,
                            decodedSessionToken.eraCredentials,
                            ctx.params.agentFingerprint, ctx.state.config);
                }
                catch (e) {
                    if (e.code !== 'MALFORMED_TOKEN'
                            && e.code !== 'INVALID_CREDENTIALS') {
                        throw errors.unexpectedError(e);
                    }

                    error = e;
                }

                ctx.status = 200;
                ctx.body = {
                    resolution: session ? 'valid'
                            : error.prejudice ? 'invalid-with-prejudice'
                            : 'invalid-no-prejudice',
                    relog: lodash.get(error, 'details.relog'),
                    retry: lodash.get(error, 'details.retry'),
                };

                if (session) {
                    ctx.body.session = {
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
                    };

                    if (session.nextEraCredentials) {
                        ctx.body.nextSessionToken = tokens.encode(session.id,
                                session.eraCredentials, ctx.state.config);
                    }
                }
            }
            else {
                throw new Error();
            }
        }
    }
};
