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
    MalformedToken: class extends SbError {
        static messageTemplate = 'Malformed token: {{reason}}';
    },
    malformedToken(reason) {
        return new this.MalformedToken({ reason });
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
