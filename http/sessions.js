'use strict';

const assert = require('assert');
const bodyParser = require('koa-bodyparser');
const bs58 = require('bs58');
const errors = require('../standard-errors');
const gutCheck = require('../utils/gut-check-auth-sig');
const SbError = require('@shieldsbetter/sberror2')
const Joi = require('joi');

class UnableToCreateUser extends SbError {
    static messageTemplate = 'Unable to create user. {{additionalInfo}}';
}

class UnknownMechanism extends SbError {
    static messageTemplate = 'Unknown POST /session mechanism: {{{got}}}. '
            + 'Should be "dev".';
}

class MalformedToken extends SbError {
    static messageTemplate = 'Malformed token: {{reason}}';
}

module.exports = router => {
    router.get('/realms/:realmId/sessions', async (ctx, next) => {
        Joi.assert({
            query: ctx.query
        }, Joi.object({
            query: {
                accessToken: Joi.string().optional(),
                agentFingerprint: Joi.string().optional()
            }
        }));

        let after, docs;
        if (ctx.query.accessToken) {
            const decodedAccessToken = decodeToken(
                gutCheck.verifyAndOpen(bs58.decode(ctx.query.accessToken),
                        ctx.state.config));

            if (decodedAccessToken.protocol !== 0) {
                throw new MalformedToken({
                    reason: 'Does not appear to be an access token.'
                });
            }

            const session = await ctx.services.sessions.validateAccessToken(
                    ctx.params.realmId, decodedAccessToken.sessionId,
                    decodedAccessToken.secret,
                    decodedAccessToken.signature,
                    ctx.params.agentFingerprint)

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

                ctx.status = 201;
                const {
                    accessSecret,
                    accessSecretSignature,
                    id: sessionId,
                    refreshSecret,
                    refreshSecretSignature
                } = await ctx.services.sessions.create(
                    ctx.params.realmId,
                    ctx.request.body.agentFingerprint,
                    ctx.request.body.userId
                );

                const sessionIdBuffer = Buffer.from(sessionId, 'utf8');

                const accessToken = bs58.encode(gutCheck.sign(Buffer.concat([
                    Buffer.from([0]),
                    Buffer.from([sessionIdBuffer.length]),
                    sessionIdBuffer,
                    accessSecret,
                    accessSecretSignature
                ]), ctx.state.config));

                const refreshToken = bs58.encode(gutCheck.sign(Buffer.concat([
                    Buffer.from([1]),
                    Buffer.from([sessionIdBuffer.length]),
                    sessionIdBuffer,
                    refreshSecret,
                    refreshSecretSignature
                ]), ctx.state.config));

                ctx.body = {
                    id: sessionId,
                    accessToken,
                    refreshToken
                };

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

function decodeToken(t) {
    if (typeof t === 'string') {
        t = bs58.decode(t);
    }

    const protocol = t.readUInt8(0);
    const sidLength = t.readUInt8(1);
    const sessionId = t.slice(2, 2 + sidLength).toString('utf8');
    const secret = t.slice(2 + sidLength, 2 + sidLength + 32);
    const signature = t.slice(2 + sidLength + 32);

    return {
        protocol,
        secret,
        sessionId,
        signature
    };
}
