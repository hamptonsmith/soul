'use strict';

const SbError = require('@shieldsbetter/sberror2');

module.exports = {
    NoSuchSession: class extends SbError {
        static messageTemplate = 'No such session: {{sessionId}}';
    },
    noSuchSession(sessionId) {
        throw new this.NoSuchSession({ sessionId });
    }
}
