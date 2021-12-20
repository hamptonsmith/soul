'use strict';

const SbError = require('@shieldsbetter/sberror2');

module.exports = {
    DuplicateUser: class extends SbError {
        static messageTemplate = 'A user with one of those user specifiers '
                + 'already exists.';
    },
    duplicateUser() {
        return new this.DuplicateUser();
    },
    InvalidCredentials: class extends SbError {
        static messageTemplate = 'Invalid credentials.';
    },
    invalidCredentials(details, cause) {
        // TODO: get rid of this grossness once I once again have control of my
        //       npm account and can publish the fix...
        if (cause) {
            return new this.InvalidCredentials(details, cause);
        }
        else {
            return new this.InvalidCredentials(details);
        }
    },
    MalformedToken: class extends SbError {
        static messageTemplate = 'Malformed token: {{reason}}';
    },
    malformedToken(reason, details, cause) {
        // TODO: get rid of this grossness once I once again have control of my
        //       npm account and can publish the fix...
        if (cause) {
            return new this.MalformedToken({ reason, ...details }, cause);
        }
        else {
            return new this.MalformedToken({ reason, ...details });
        }
    },
    NoSuchSession: class extends SbError {
        static messageTemplate = 'No such session: {{sessionId}}';
    },
    noSuchSession(sessionId) {
        return new this.NoSuchSession({ sessionId });
    },
    NoSuchUser: class extends SbError {
        static messageTemplate = 'No such user: {{description}}';
    },
    noSuchUser(description) {
        return new this.NoSuchUser({ description });
    },
    UnexpectedError: class extends SbError {
        static messageTemplate = 'Unexpected error: {{{message}}}';
    },
    unexpectedError(e) {
        return new this.UnexpectedError({ message: e.message}, e);
    }
}
