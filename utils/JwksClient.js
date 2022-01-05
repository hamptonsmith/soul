'use strict';

// None of my available options quite suited me. `jwks-rsa` and family have
// limited key types and I definitely want `oct` in addition to `ec` and `rsa`.
// `get-jwks` doesn't have rate limiting of requests and uses some global
// options that make it challenging to set up different authorities differently.

const jwkToPem = require('jwk-to-pem');
const lodash = require('lodash');
const LRU = require('lru-cache');
const ms = require('ms');
const SbError = require('@shieldsbetter/sberror2');
const slurpUri = require('@shieldsbetter/slurp-uri');

class UnfamiliarAuthority extends SbError {
    static messageTemplate = 'Unfamiliar authority: {{{authority}}}';
}

class NoSuchKey extends SbError {
    static messageTemplate = 'No key with algorithm {{algorithm}} and id '
            + '{{kid}} for authority {{authority}}.'
}

module.exports = class JwksClient {
    constructor(config, { nower }) {
        this.config = config;
        this.cache = new LRU({
            max: 100,
            maxAge: ms('24h'),
            updateAgeOnGet: true
        });
        this.throttledSlurpUri = new ThrottledSlurpUri(nower);
    }

    async getJwks(authority) {
        // No __proto__ nonsense.
        if ({}[authority]) {
            throw new UnfamiliarAuthority({ authority });
        }

        const authorityConfig =
                lodash.get(this.config.getData(), ['jwks', authority]);

        if (!authorityConfig) {
            throw new UnfamiliarAuthority({ authority });
        }

        let jwks;
        if (authorityConfig.uri) {
            jwks = await this.throttledSlurpUri.slurpUri(
                    authorityConfig.uri);
        }
        else if (authorityConfig.literal) {
            jwks = authorityConfig.literal;
        }
        else {
            throw new UnfamiliarAuthority({ authority },
                    new Error(`config.jwks["${authority}"] is misconfigured. `
                            + `Must have field \`uri\` or \`literal\`.`));
        }

        return jwks;
    }

    async getJwk(authority, qAlg, qKid) {
        const cacheKey = JSON.stringify([authority, qAlg, qKid]);

        let jwk;
        if (this.cache.has(cacheKey)) {
            jwk = this.cache.get(cacheKey);
        }
        else {
            const jwks = await this.getJwks(authority);

            jwk = jwks.keys.find(key =>
                    key.alg === qAlg
                    && key.kid === qKid
                    && key.use === 'sig');
        }

        if (!jwk) {
            throw new NoSuchKey({ authority, algorithm: qAlg, kid: qKid });
        }

        this.cache.set(cacheKey, jwk);

        return jwk;
    }

    async getSecret(authority, qAlg, qKid) {
        const jwk = await this.getJwk(authority, qAlg, qKid);

        let secret;
        if (jwk.kty === 'RSA' || jwk.kty === 'EC') {
            secret = jwkToPem(jwk);
        }
        else if (jwk.kty === 'oct') {
            secret = Buffer.from(jwk.k, 'base64url');
        }
        else {
            throw new NoSuchKey({
                authority,
                algorithm: qAlg,
                kid: qKid
            }, new Error(`Key ${qKid} with algorithm ${qAlg} for authority `
                    + `${authority} has an unknown \`kty\`: ${jwk.kty}`));
        }

        return secret;
    }
};

class ThrottledSlurpUri {
    cachedResults = {};

    constructor(nower) {
        this.nower = nower;
    }

    async slurpUri(uri) {
        let cacheEntry;

        if (cachedResults[uri]) {
            if (cachedResult[uri].fetchedAt + ms('30s') >= this.nower()) {
                cacheEntry = cachedResult[uri];
            }
        }

        if (!result) {
            cacheEntry = {
                data: JSON.parse(await slurpUri(uri, { encoding: 'utf8' })),
                fetchedAt: this.nower()
            };
        }

        cachedResults[uri] = cacheEntry;

        return cacheEntry.data;
    }
}
