'use strict';

const assert = require('assert');
const bs58 = require('bs58');
const crypto = require('crypto');
const util = require('util');

module.exports = {
    encode: (sessionId, eraCredentials, config) => {
        const tokenData = Buffer.from(JSON.stringify({
            eraNumber: eraCredentials.eraNumber,
            securityContext: eraCredentials.securityContext,
            sessionId: sessionId,
            tokenId: eraCredentials.tokenId
        }), 'utf8');

        const signature = crypto
                .createHmac('sha256', bs58.decode(config.signingSecret))
                .update(tokenData)
                .digest();

        return bs58.encode(Buffer.concat([
            Buffer.from([0]),
            signature,
            tokenData
        ]));
    },

    // Returns a `{ "<session id>": { "tokens": [<decoded token>] } }`
    // containing valid tokens mapped to their parent sessions. We presume this
    // is coming straight from the user's cookies, so we don't bomb on a bad
    // token. A bad token is just not a token intended for us apparently.
    decodeValid: (tokenStrs, config) => {
        const result = {};

        for (const tokenStr of tokenStrs) {
            try {
                const tokenBuf = bs58.decode(tokenStr);

                if (tokenBuf.readUInt8(0) !== 0) {
                    continue;
                }

                const dataBuf = tokenBuf.slice(33);

                const actualSignature = tokenBuf.slice(1, 33);
                const expectedSignature = crypto
                        .createHmac('sha256', bs58.decode(config.signingSecret))
                        .update(dataBuf)
                        .digest();

                if (!actualSignature.equals(expectedSignature)) {
                    continue;
                }

                const tokenData = JSON.parse(dataBuf.toString('utf8'));

                const sessionId = tokenData.sessionId;
                delete tokenData.sessionId;

                if (!result[sessionId]) {
                    result[sessionId] = { tokens: [] };
                }

                result[sessionId].tokens.push(tokenData);
            }
            catch (e) { }
        }

        return result;
    }
};
