'use strict';

const assert = require('assert');
const bodyParser = require('koa-bodyparser');
const bs58 = require('bs58');
const errors = require('../standard-errors');
const httpUtils = require('./http-utils');
const LinkHeader = require('http-link-header');
const SbError = require('@shieldsbetter/sberror2')
const tokens = require('../utils/tokens');
const validator = require('../utils/validator');

class UnknownMechanism extends SbError {
    static messageTemplate = 'Unknown POST /session mechanism: {{{got}}}. '
            + 'Should be "dev".';
}

module.exports = {
    'GET /realms/:realmId/sessions': {
        handler: async (ctx, next) => {
            const page = await ctx.state.services.sessions.byCreationTime.find(
                    { realmId: ctx.params.realmId },
                    ctx.query.after,
                    parseInt(ctx.query.limit));

            ctx.status = 200;
            ctx.body = page.docs;

            if (page.after) {
                const path = `realms/${ctx.params.realmId}`
                        + `/sessions`
                        + `?after=${page.after}&limit=${page.docs.length}`;

                const link = new LinkHeader();
                link.set({ rel: 'next', uri: `${ctx.state.baseHref}/${path}` });
                ctx.set('link', link.toString());
            }
        }
    },
    'POST /realms/:realmId/securityContexts/:contextName/sessions': {
        bodyparser: {},
        validator: check => ({
            body: check.switch(
                { mechanism: check.string() },
                actual => actual.mechanism.trim(),
                {
                    anonymous: {},
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
    anonymous: async ctx => {
        if (ctx.params.contextName !== 'anonymous') {
            throw new validator.ValidationError('mechanism `anonymous` may '
                    + 'only be used with security context `anonymous`',
                    ctx.params.contextName);
        }

        const { status, body } = await jwtPayloadToSessionResult(
                null, ctx, {
                    '/realmId': '/path/realmId',
                    '/securityContextName': '/body/securityContext',
                    '/agentFingerprint': '/body/agentFingerprint',
                    '/subjectId': '/body/token'
                });

        ctx.status = status;
        ctx.body = body;
    },
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
                    ctx.params.contextName,
                    jwtPayload,
                    ctx.request.body.agentFingerprint));

    const token = tokens.encode(ctx.params.realmId, session.id,
            session.eraCredentials, ctx.state.serviceConfig);
    const body = {
        addTokens: [ token ],
        retireTokens: [],
        sessions: [
            httpUtils.copySessionFields(session, ctx)
        ]
    };

    return {
        status: 201,
        body
    };
}
