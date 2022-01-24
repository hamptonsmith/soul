'use strict';

const bodyParser = require('koa-bodyparser');
const errors = require('../standard-errors');
const httpUtils = require('./http-utils');
const lodash = require('lodash');
const tokens = require('../utils/tokens');

const { DateTime } = require('luxon');

module.exports = {
    'POST /realms/:realmId/securityContexts/:contextName/accessAttempts': {
        bodyparser: {},
        validator: check => ({
            body: {
                agentFingerprint: check.optional(check.agentFingerprint()),
                sessionTokens: check.array({
                    elements: check.sessionToken()
                })
            }
        }),
        handler: async (ctx, next) => {
            const {
                addTokens,
                retireTokens,
                sessions,
                suspiciousSessionIds,
                suspiciousTokens
            } = await httpUtils.remapValidationErrorPaths(
                {
                    '/realmId': '/path/realmId',
                    '/desiredSecurityContext': '/path/contextName',
                    '/tokens': '/body/sessionTokens',
                    '/agentFingerprint': '/body/agentFingerprint'
                },
                () => ctx.state.services.sessions
                        .recordLineActivityAndReturnSessions(
                                ctx.params.realmId, ctx.params.contextName,
                                ctx.request.body.sessionTokens,
                                ctx.request.body.agentFingerprint));

            ctx.status = 200;
            ctx.body = {
                addTokens,
                retireTokens,
                sessions:
                        sessions.map(s => httpUtils.copySessionFields(s, ctx)),
                suspiciousSessionIds,
                suspiciousTokens
            };
        }
    }
};
