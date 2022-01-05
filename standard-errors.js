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
    NoSuchRealm: class extends SbError {
        static messageTemplate = 'No such realm: {{realmId}}';
    },
    noSuchRealm(realmId) {
        return new this.NoSuchRealm({ realmId });
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
