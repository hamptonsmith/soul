'use strict';

const buildGetJwks = require('jwks-rsa');
const errors = require('../standard-errors');
const jsonwebtoken = require('jsonwebtoken');
const JwksClient = require('../utils/JwksClient');
const ms = require('ms');
const SbError = require('@shieldsbetter/sberror2');

class UnknownKey extends SbError {
    static messageTemplate = 'Unknown key for authority {{{authority}}} with '
            + 'algorithm {{{algorithm}}} and id {{{kid}}}.';
}

class UnacceptableJwt extends SbError {
    static messageTemplate = 'Invalid JWT: {{{reason}}}';
}

module.exports = class JwtsService {
    cachedJwkClients = {};

    constructor(config, runtimeDeps) {
        this.config = config;
        this.jwksClient = new JwksClient(config, runtimeDeps)
    }

    async verify(token) {
        // `jsonwebtoken` swallows useful errors in get-key functions, so we
        // do this outside and just pass in the right answer.
        const secret = await getSecretForToken.call(this, token);

        const payload = await new Promise((resolve, reject) => {
            jsonwebtoken.verify(token, secret, {
                audience: this.config.getData().audienceId
            }, (err, payload) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(payload);
                }
            });
        });

        if (!payload.sub) {
            throw errors.notAuthenticated('Not an id token.');
        }

        if (!payload.iss || !payload.iat) {
            throw new Error('I can\'t use this token. :( '
                    + JSON.stringify(payload));
        }

        return payload;
    }
};

async function getSecretForToken(token) {
    const untrustedJwt = jsonwebtoken.decode(token, { complete: true });

    // `jsonwebtoken` swallows useful errors in get-key functions, so we
    // do this outside and just pass in the right answer.

    if (!untrustedJwt.payload.iss) {
        throw new UnacceptableJwt({
            reason: 'No `iss` claim.'
        });
    }

    if (!untrustedJwt.header.alg) {
        throw new UnacceptableJwt({
            reason: 'No `alg` header.'
        });
    }

    if (!untrustedJwt.header.kid) {
        throw new UnacceptableJwt({
            reason: 'No `kid` header.'
        });
    }

    return await this.jwksClient.getSecret(
            untrustedJwt.payload.iss, untrustedJwt.header.alg,
            untrustedJwt.header.kid);
}
