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

module.exports = class JwtsService {
    cachedJwkClients = {};

    constructor(config, runtimeDeps) {
        this.config = config;
        this.jwksClient = new JwksClient(config, runtimeDeps)
    }

    async verify(token) {
        const payload = await new Promise((resolve, reject) => {
            jsonwebtoken.verify(token, async (header, getKeyCb) => {
                try {
                    const secret = await this.jwksClient.getSecret(
                            header.iss, header.alg, header.kid);
                    getKeyCb(null, secret);
                }
                catch (e) {
                    getKeyCb(errors.trackingError(e));
                }
            }, {
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
