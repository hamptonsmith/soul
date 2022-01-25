'use strict';

const assert = require('assert');
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

    constructor(leylineSettings, metricsService, runtimeDeps) {
        this.leylineSettings = leylineSettings;
        this.metricsService = metricsService;
        this.jwksClient =
                new JwksClient(leylineSettings, metricsService, runtimeDeps);
    }

    async verify(token) {
        // `jsonwebtoken` swallows useful errors in get-key functions, so we
        // do this outside and just pass in the right answer.
        const secret = await getSecretForToken.call(this, token);

        const payload = await new Promise((resolve, reject) => {
            jsonwebtoken.verify(token, secret, {
                audience: this.leylineSettings.getConfig().audienceId
            }, (err, payload) => {
                if (err) {
                    assert(['TokenExpiredError', 'JsonWebTokenError',
                            'NotBeforeError'].includes(err.name));

                    reject(new UnacceptableJwt({ reason: err.message }));
                }
                else {
                    resolve(payload);
                }
            });
        });

        if (!payload.sub) {
            throw new UnacceptableJwt({ reason: 'No `sub` claim.' });
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
