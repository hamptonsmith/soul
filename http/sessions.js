'use strict';

const assert = require('assert');
const bodyParser = require('koa-bodyparser');
const bs58 = require('bs58');
const errors = require('../standard-errors');
const tokens = require('../utils/tokens');
const SbError = require('@shieldsbetter/sberror2')

const { remapValidationErrorPaths } = require('./http-utils');

class UnableToCreateUser extends SbError {
    static messageTemplate = 'Unable to create user. {{additionalInfo}}';
}

class UnknownMechanism extends SbError {
    static messageTemplate = 'Unknown POST /session mechanism: {{{got}}}. '
            + 'Should be "dev".';
}

module.exports = {
    'GET /realms/:realmId/sessions': {
        validator: {
            query: {
                agentFingerprint: check => check.optional(check.string({
                    minLength: 1,
                    maxLength: 1000
                })),
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
                        [ctx.query.sessionToken], ctx.state.config);

                if (Object.keys(decodedSessionTokens).length === 0) {
                    docs = [];
                }
                else {
                    const sessionId = Object.keys(decodedTokens)[0];
                    const { tokens: credentialList } = decodedTokens[sessionId];

                    const session = await remapValidationErrorPaths({
                        '/realmId': '/path/realmId',
                        '/sessionId': '/querystring/sessionToken',
                        '/agentFingerprint': '/querystring/agentFingerprint'
                    }, () => ctx.services.sessions.validateSessionCredentials(
                                ctx.params.realmId,
                                sessionId,
                                credentialList,
                                ctx.query.agentFingerprint,
                                ctx.state.config));

                    docs = [session];
                }
            }
            else {
                ({ after, docs } = await remapValidationErrorPaths({
                    '/after': '/querystring/after',
                    '/limit': '/querystring/limit'
                }, () => ctx.services.realms.byCreationTime.find(
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
                    userId: d.userId
                }))
            };
        }
    },
    'POST /realms/:realmId/sessions': {
        validator: {
            body: [
                {
                    agentFingerprint: check => check.optional(check.string({
                        minLength: 1,
                        maxLength: 500
                    }))
                },
                check => check.switch(
                    actual => actual.mechanism.trim().toLowerCase(),
                    {
                        dev: {
                            existingUserOk:
                                    check => check.optional(check.boolean()),
                            newUserOk: check => check.optional(check.boolean()),
                            userId: check => check.string({
                                regexp: /^usr_[a-zA-Z0-9]{1,100}$/
                            })
                        },
                        token: {
                            sessionTokens: check => check.array({
                                elements: check.sessionToken()
                            })
                        }
                    },
                    (check, actual) => check.invalid(
                        'No such mechanism: ' + actual.mechanism,
                        actual.mechanism))
            ]
        },
        handler: async (ctx, next) => {
            await sessionMechanisms[ctx.request.body.mechanism](ctx);
        }
    }
};

var sessionMechanisms = {
    dev: async ctx => {
        let userId;

        // Try to make the user if requested...
        if (ctx.request.body.newUserOk) {
            try {
                userId = await remapValidationErrorPaths({
                    '/realmId': '/path/realmId',
                    '/metadata': '/body/metadata',
                    '/userId': '/body/userId'
                }, () => ctx.services.users.create(
                        ctx.params.realmId, ctx.request.body.metadata,
                        { id: ctx.params.userId }));
            }
            catch (e) {
                if (e.code !== 'DUPLICATE_USER') {
                    throw errors.unexpectedError(e);
                }
            }
        }

        // Try to find the existing user if requested...
        if (!userId && ctx.request.body.existingUserOk) {
            const user = await ctx.services.users.fetchById(
                    ctx.params.realmId, ctx.request.body.userId);

            if (!user) {
                throw errors.duplicateUser();
            }

            userId = user.id;
        }

        const session = await remapValidationErrorPaths({
            '/realmId': '/path/realmId',
            '/agentFingerprint': '/body/agentFingerprint',
            '/userId': '/body/userId'
        }, () => ctx.services.sessions.create(
                ctx.params.realmId,
                ctx.request.body.agentFingerprint,
                ctx.request.body.userId,
                ctx.state.config));

        const sessionToken = tokens.encode(
                session.id, session.eraCredentials, ctx.state.config);

        ctx.status = 201;
        ctx.body = {
            createdAt: session.createdAt,
            currentEraStartedAt: session.currentEraStartedAt,
            currentEraNumber: session.currentEraNumber,
            href: `${ctx.state.baseHref}`
                    + `/realms/${ctx.params.realmId}`
                    + `/sessions/${session.id}`,
            id: session.id,
            lastUsedAt: session.lastUsedAt,
            realmId: session.realmId,
            sessionTokens: [sessionToken],
            userId: session.userId
        };
    },
    token: async ctx => {
        throw new Error();
    }
};
