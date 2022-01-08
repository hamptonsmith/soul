'use strict';

const assert = require('assert');
const bodyParser = require('koa-bodyparser');
const bs58 = require('bs58');
const errors = require('../standard-errors');
const httpUtils = require('./http-utils');
const tokens = require('../utils/tokens');
const SbError = require('@shieldsbetter/sberror2')

class UnknownMechanism extends SbError {
    static messageTemplate = 'Unknown POST /session mechanism: {{{got}}}. '
            + 'Should be "dev".';
}

module.exports = {
    'GET /realms/:realmId/sessions': {
        validator: {
            query: {
                sessionToken: check => check.optional(check.string({
                    minLength: 1,
                    maxLength: 500
                }))
            }
        },
        handler: async (ctx, next) => {
            let after, docs;
            if (ctx.query.sessionToken) {
                const decodedSessionTokens = tokens.decodeValid(
                        [ctx.query.sessionToken], ctx.state.serviceConfig);

                if (Object.keys(decodedSessionTokens).length === 0) {
                    docs = [];
                }
                else {
                    const sessionId = Object.keys(decodedTokens)[0];
                    const { tokens: credentialList } = decodedTokens[sessionId];

                    const session = await httpUtils.remapValidationErrorPaths({
                        '/realmId': '/path/realmId',
                        '/sessionId': '/querystring/sessionToken',
                        '/agentFingerprint': '/querystring/agentFingerprint'
                    }, () => ctx.state.services.sessions
                            .validateSessionCredentials(
                                    ctx.params.realmId,
                                    sessionId,
                                    credentialList,
                                    ctx.query.agentFingerprint,
                                    ctx.state.serviceConfig));

                    docs = [session];
                }
            }
            else {
                ({ after, docs } = await httpUtils.remapValidationErrorPaths({
                    '/after': '/querystring/after',
                    '/limit': '/querystring/limit'
                }, () => ctx.state.services.realms.byCreationTime.find(
                            { realmId: ctx.params.realmId },
                            ctx.query.after,
                            ctx.query.limit !== undefined
                                    ? Number.parseInt(ctx.query.limit)
                                    : undefined)));
            }

            ctx.status = 200;
            ctx.body = {
                continueToken: after,
                continueLink: after ? `${ctx.state.baseHref}`
                        + `/realms/${ctx.params.realmId}/sessions`
                        + `?after=${after}&limit=${docs.length}` : undefined,
                resources: docs.map(d => ({
                    href: `${ctx.state.baseHref}`
                            + `/realms/${ctx.params.realmId}`
                            + `/sessions/${d.id}`,

                    createdAt: d.createdAt,
                    currentGenerationCreatedAt: d.currentGenerationCreatedAt,
                    currentGenerationNumber: d.currentGenerationNumber,
                    lastUsedAt: d.lastUsedAt,
                    id: d.id,
                    realmId: d.realmId,
                    subjectId: d.subjectId
                }))
            };
        }
    },
    'POST /realms/:realmId/sessions': {
        bodyparser: {},
        validator: check => ({
            body: check.switch(
                { mechanism: check.string() },
                actual => actual.mechanism.trim(),
                {
                    dev: {
                        jwtPayload: {
                            iat: check.number(),
                            iss: check.string({
                                    minLength: 1, maxLength: 100}),
                            sub: check.string({
                                    minLength: 1, maxLength: 100}),
                        }
                    },
                    idToken: {
                        token: check.string({
                            regexp: /^[a-zA-Z0-9_\-\.]{1,5000}$/
                        })
                    }
                },
                (check, actual) => check.invalid(
                    'No such mechanism: ' + actual.mechanism,
                    actual.mechanism))
        }),
        handler: async (ctx, next) => {
            await sessionMechanisms[ctx.request.body.mechanism](ctx);
        }
    }
};

var sessionMechanisms = {
    dev: async ctx => {
        const { status, body } = await jwtPayloadToSessionResult(
                ctx.request.body.jwtPayload, ctx, {
                    '/realmId': '/path/realmId',
                    '/securityContextName': '/body/securityContext',
                    '/agentFingerprint': '/body/agentFingerprint',
                    '/subjectId': '/body/jwtPayload'
                });

        ctx.status = status;
        ctx.body = body;
    },
    idToken: async ctx => {
        const jwtPayload =
                await ctx.state.services.jwts.verify(ctx.request.body.token);

        const { status, body } = await jwtPayloadToSessionResult(
                jwtPayload, ctx, {
                    '/realmId': '/path/realmId',
                    '/securityContextName': '/body/securityContext',
                    '/agentFingerprint': '/body/agentFingerprint',
                    '/subjectId': '/body/token'
                });

        ctx.status = status;
        ctx.body = body;
    }
};

async function jwtPayloadToSessionResult(jwtPayload, ctx, errorPathMapping) {
    const session = await httpUtils.remapValidationErrorPaths(errorPathMapping,
            () => ctx.state.services.sessions.create(
                    ctx.params.realmId,
                    ctx.request.body.securityContext,
                    jwtPayload,
                    ctx.request.body.agentFingerprint,
                    JSON.stringify([jwtPayload.iss, jwtPayload.sub]),
                    ctx.state.serviceConfig));

    const token = tokens.encode(
            session.id, session.eraCredentials, ctx.state.serviceConfig);
    const body = {
        addTokens: [ token ],
        retireTokens: []
    };

    httpUtils.copySessionFields(session, body, ctx);

    return {
        status: 201,
        body
    };
}
