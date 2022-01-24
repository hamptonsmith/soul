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
