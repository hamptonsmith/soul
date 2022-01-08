'use strict';

const bodyParser = require('koa-bodyparser');
const errors = require('../standard-errors');
const httpUtils = require('./http-utils');
const lodash = require('lodash');
const tokens = require('../utils/tokens');

const { DateTime } = require('luxon');

module.exports = {
    'POST /realms/:realmId/accessAttempts': {
        bodyparser: {},
        validator: check => ({
            body: {
                securityContext: check.versionedSecurityContextName(),
                sessionTokens: check => check.array({
                    elements: check.sessionToken()
                })
            }
        }),
        handler: async (ctx, next) => {
            const decodedTokens = tokens.decodeValid(
                    ctx.request.body.sessionTokens, ctx.state.serviceConfig);

            let session;
            let error;

            try {
                const sessionsWithCorrectSecurityContext =
                        Object.entries(decodedTokens)
                        .filter(([,{tokens}]) => tokens.every(t =>
                            t.securityContext ===
                                    ctx.request.body.securityContext));

                if (Object.keys(sessionsWithCorrectSecurityContext)
                        .length === 0) {
                    throw errors.invalidCredentials({
                        reason: 'no valid tokens'
                    });
                }

                const [ sessionId, { tokens: credentialsList } ] =
                        sessionsWithCorrectSecurityContext[0];

                await httpUtils.remapValidationErrorPaths({
                    '/realmId': '/path/realmId',
                    '/expectedSecurityContext': '/body/securityContext',
                    '/sessionId': '/body/sessionTokens',
                    '/agentFingerprint': '/body/agentFingerprint'
                }, async () => {
                    session = await ctx.state.services.sessions
                            .validateSessionCredentials(
                                    ctx.params.realmId,
                                    ctx.request.body.securityContext, sessionId,
                                    credentialsList,
                                    ctx.params.agentFingerprint,
                                    ctx.state.serviceConfig);
                });
            }
            catch (e) {
                if (e.code !== 'MALFORMED_TOKEN'
                        && e.code !== 'INVALID_CREDENTIALS') {
                    throw errors.unexpectedError(e);
                }

                ctx.state.log(`\n\n===== Access Attempt in Request ${ctx.request.id} Rejected =====`)
                ctx.state.log(e.stack);
                ctx.state.log();

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
                const addTokens = [];

                if (session.nextEraCredentials) {
                    addTokens.push(tokens.encode(
                            session.id,
                            session.nextEraCredentials,
                            ctx.state.serviceConfig));
                }

                const retireTokens = session.retireCredentials.map(c =>
                        tokens.encode(session.id, c, ctx.state.serviceConfig));

                ctx.body.session = {
                    addTokens,
                    retireTokens: session.retireCredentials.map(c =>
                            tokens.encode(
                                    session.id, c, ctx.state.serviceConfig))
                };

                httpUtils.copySessionFields(session, ctx.body.session, ctx);
            }
        }
    }
};
