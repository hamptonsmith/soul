'use strict';

const assert = require('assert');
const bs58 = require('bs58');
const crypto = require('crypto');

module.exports = {
    encode: (sessionId, eraCredentials, config) => {
        const sessionIdBuffer = Buffer.from(sessionId, 'utf8');

        if (sessionIdBuffer.length > 255) {
            throw new Error('Session id too long: ' + sessionId)
        }

        const eraNumber = Buffer.alloc(4);
        eraNumber.writeUInt32BE(eraCredentials.index);

        const innerToken = Buffer.concat([
            Buffer.from([0]),
            Buffer.from([sessionIdBuffer.length]),
            sessionIdBuffer,
            eraNumber,
            eraCredentials.secret,
            eraCredentials.signature
        ]);

        const [secretIdStr, { secret: secretStr }] =
                Object.entries(config.signingKeys)
                        .find(([sid, s]) => s.default);

        const secretBuf = bs58.decode(secretStr);

        const signature = crypto.createHmac('sha256', secretBuf)
                .update(innerToken).digest().slice(0, 4);

        if (innerToken.length > 65535) {
            throw new Error('Data too long.');
        }

        const dataLength = Buffer.alloc(2);
        dataLength.writeUInt16BE(innerToken.length);

        const secretIdBuf = Buffer.from(secretIdStr, 'utf8');

        if (secretIdBuf.length > 255) {
            throw new Error('Signing key id too long: ' + secretIdStr);
        }

        const secretIdLength = Buffer.alloc(1);
        secretIdLength.writeUInt8(secretIdBuf.length);

        return bs58.encode(Buffer.concat([
            Buffer.from([0]),
            dataLength,
            innerToken,
            secretIdLength,
            secretIdBuf,
            signature
        ]));
    },

    // Validates the "envelope" of the token, which can be validated without
    // recourse to the database. The contents of the envelope will need to be
    // further validated once session data is loaded.
    decode: (tokenStr, config) => {
        const tokenBuf = bs58.decode(tokenStr);

        assert.equal(tokenBuf.readUInt8(0), 0);

        const dataLength = tokenBuf.readUInt16BE(1);
        const data = tokenBuf.slice(3, 3 + dataLength);

        const secretIdLength = tokenBuf.readUInt8(3 + dataLength);
        const secretId =
                tokenBuf.slice(4 + dataLength, 4 + dataLength + secretIdLength)
                .toString('utf8');

        if (!config.signingKeys[secretId]) {
            throw new Error();
        }

        const actualSignature = tokenBuf.slice(4 + dataLength + secretIdLength);
        const expectedSignature =
                crypto.createHmac(
                        'sha256',
                        bs58.decode(config.signingKeys[secretId].secret))
                    .update(data).digest().slice(0, 4);

        if (!actualSignature.equals(expectedSignature)) {
            throw new Error();
        }

        const protocol = data.readUInt8(0);
        const sidLength = data.readUInt8(1);
        const sessionId = data.slice(2, 2 + sidLength).toString('utf8');
        const eraNumber = data.readUInt32BE(2 + sidLength);
        const secret = data.slice(6 + sidLength, 6 + sidLength + 32);
        const signature = data.slice(6 + sidLength + 32);

        return {
            eraCredentials: {
                index: eraNumber,
                secret,
                signature
            },
            protocol,
            sessionId
        };
    }
};
