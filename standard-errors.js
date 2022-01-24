'use strict';

const SbError = require('@shieldsbetter/sberror2');

module.exports = {
    InvalidCredentials: class extends SbError {
        static messageTemplate = 'Invalid credentials.';
    },
    invalidCredentials(details, cause) {
        return new this.InvalidCredentials(details, cause);
    },
    MalformedToken: class extends SbError {
        static messageTemplate = 'Malformed token: {{reason}}';
    },
    malformedToken(reason, details, cause) {
        return new this.MalformedToken({ reason, ...details }, cause);
    },
    NoSuchAssertion: class extends SbError {
        static messageTemplate = 'Security context {{{securityContextName}}} '
                + 'of realm "{{{realmId}}}" has no such assertion: '
                + '{{{assertionName}}}';
    },
    noSuchAssertion(realmId, securityContextName, assertionName) {
        return new this.NoSuchAssertion({
            assertionName,
            realmId,
            securityContextName
        });
    },
    NoSuchRealm: class extends SbError {
        static messageTemplate = 'No such realm: {{realmId}}';
    },
    noSuchRealm(realmId) {
        return new this.NoSuchRealm({ realmId });
    },
    NoSuchSecurityContext: class extends SbError {
        static messageTemplate = 'Realm "{{{realmId}}}" has no such security '
                + 'context: {{{securityContextName}}}'
    },
    noSuchSecurityContext(realmId, securityContextName) {
        return new this.NoSuchSecurityContext({ realmId, securityContextName });
    },
    NoSuchSession: class extends SbError {
        static messageTemplate = 'No such session: {{sessionId}}';
    },
    noSuchSession(sessionId) {
        return new this.NoSuchSession({ sessionId });
    },
    NotAuthenticated: class extends SbError {
        static messageTemplate =
                'Could not establish client identity: {{reason}}';
    },
    notAuthenticated(reason, ...more) {
        return new this.NotAuthenticated({ reason }, ...more);
    },
    trackingError(cause) {
        const e = new Error(cause.message);
        e.details = cause.details;
        e.code = cause.code;

        return e;
    },
    UnexpectedError: class extends SbError {
        static messageTemplate = 'Unexpected error: {{{message}}}';
    },
    unexpectedError(e) {
        return new this.UnexpectedError({ message: e.message }, e);
    }
}
