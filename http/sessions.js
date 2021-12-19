'use strict';

const assert = require('assert');
const bodyParser = require('koa-bodyparser');
const bs58 = require('bs58');
const errors = require('../standard-errors');
const tokens = require('../utils/tokens');
const SbError = require('@shieldsbetter/sberror2')
const Joi = require('joi');

class UnableToCreateUser extends SbError {
    static messageTemplate = 'Unable to create user. {{additionalInfo}}';
}

class UnknownMechanism extends SbError {
    static messageTemplate = 'Unknown POST /session mechanism: {{{got}}}. '
            + 'Should be "dev".';
}

module.exports = router => {
    router.get('/realms/:realmId/sessions', async (ctx, next) => {
        Joi.assert({
            query: ctx.query
        }, Joi.object({
            query: {
                sessionToken: Joi.string().optional(),
                agentFingerprint: Joi.string().optional()
            }
        }));

        let after, docs;
        if (ctx.query.sessionToken) {
            const decodedSessionToken =
                    tokens.decode(ctx.query.sessionToken, ctx.state.config);

            if (decodedSessionToken.protocol !== 0) {
                throw errors.malformedToken('Does not appear to be an session token.');
            }

            const session = await ctx.services.sessions.validateSessionToken(
                    ctx.params.realmId, decodedSessionToken.sessionId,
                    decodedSessionToken.eraCredentials,
                    ctx.params.agentFingerprint, ctx.state.config);

            docs = [session];
        }
        else {
            ({ after, docs } = await ctx.services.realms.byCreationTime.find(
                { realmId: ctx.params.realmId },
                ctx.query.after,
                ctx.query.limit !== undefined
                        ? Number.parseInt(ctx.query.limit)
                        : undefined));
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
    });

    router.post('/realms/:realmId/sessions', bodyParser(),
            async (ctx, next) => {

        switch (ctx.request.body.mechanism) {
            case 'dev': {
                Joi.assert({
                    body: ctx.request.body
                }, Joi.object({
                    body: {
                        agentFingerprint:
                                Joi.string().optional().min(1).max(500),
                        existingUserOk: Joi.boolean(),
                        newUserOk: Joi.boolean(),
                        userId: Joi.string().required().pattern(
                                /^usr_[a-zA-Z0-9]{1,100}$/),
                    }
                }).strict(), {
                    allowUnknown: true
                });

                let userId;

                // Try to make the user if requested...
                if (ctx.request.body.newUserOk) {
                    try {
                        userId = await ctx.services.users.create(
                                ctx.params.realmId, ctx.request.body.metadata,
                                { id: ctx.params.userId });
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

                const session = await ctx.services.sessions.create(
                    ctx.params.realmId,
                    ctx.request.body.agentFingerprint,
                    ctx.request.body.userId
                );

                const sessionIdBuffer = Buffer.from(session.id, 'utf8');

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
                    sessionToken,
                    userId: session.userId
                };

                break;
            }
            case 'token': {
                Joi.assert({
                    body: ctx.request.body
                }, Joi.object({
                    body: {
                        sessionToken: Joi.string().min(1).max(500).required()
                    }
                }).unknown());

                const decodedSessionToken =
                        tokens.decode(ctx.body.sessionToken, ctx.state.config);

                if (decodedSessionToken.protocol !== 0) {
                    throw errors.malformedToken(
                            'Does not appear to be a session token.');
                }

                const session =
                        await ctx.services.sessions.validateSessionToken(
                                ctx.params.realmId,
                                decodedAccessToken.sessionId,
                                decodedSessionToken.eraCredentials,
                                ctx.params.agentFingerprint, ctx.state.config)

                break;
            }
            default: {
                throw new UnknownMechanism({
                    got: ctx.request.body.mechanism
                });
            }
        }
    });
};
