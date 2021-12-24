'use strict';

const bodyParser = require('koa-bodyparser');
const errors = require('../standard-errors');
const lodash = require('lodash');
const tokens = require('../utils/tokens');

const { DateTime } = require('luxon');
const { remapValidationErrorPaths } = require('./http-utils');

module.exports = {
    'POST /realms/:realmId/accessAttempts': {
        validator: {
            body: {
                sessionTokens: check => check.array({
                    elements: check.sessionToken()
                })
            }
        },
        handler: async (ctx, next) => {
            if (ctx.request.body.sessionTokens) {
                const decodedTokens = tokens.decodeValid(
                        ctx.request.body.sessionTokens, ctx.state.config);

                let session;
                let error;

                try {
                    if (Object.keys(decodedTokens).length === 0) {
                        throw errors.invalidCredentials({
                            reason: 'no valid tokens'
                        });
                    }

                    const sessionId = Object.keys(decodedTokens)[0];
                    const { tokens: credentialList } = decodedTokens[sessionId];

                    await remapValidationErrorPaths({
                        '/realmId': '/path/realmId',
                        '/sessionId': '/body/sessionTokens',
                        '/agentFingerprint': '/body/agentFingerprint'
                    }, async () => {
                        session = await ctx.services.sessions.validateSessionCredentials(
                                ctx.params.realmId, sessionId,
                                credentialList,
                                ctx.params.agentFingerprint,
                                ctx.state.config);
                    });
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
