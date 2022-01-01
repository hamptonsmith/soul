'use strict';

const jsonPointer = require('json-pointer');
const validate = require('../utils/validator');

module.exports = {
    copySessionFields(session, target, ctx) {
        target.createAt = session.createdAt;
        target.currentEraStartedAt = session.currentEraStartedAt;
        target.currentEraNumber = session.currentEraNumber;
        target.expiresAt = session.expiresAt;
        target.href = `${ctx.state.baseHref}`
                + `/realms/${session.realmId}`
                + `/sessions/${session.id}`;
        target.id = session.id;
        target.lastUsedAt = session.lastUsedAt;
        target.realmId = session.realmId;
        target.securityContext = session.securityContext;
        target.subjectId = session.subjectId;
    },
    async remapValidationErrorPaths(map, fn) {
        try {
            return await fn();
        }
        catch (e) {
            let cause = e;
            do {
                if (cause instanceof validate.ValidationError) {
                    const pathPtr = jsonPointer.compile(cause.path);

                    if (map[pathPtr]) {
                        cause.path = jsonPointer.parse(map[pathPtr]);
                    }
                }

                cause = cause.cause;
            } while (cause);

            throw e;
        }
    }
};
