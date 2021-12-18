'use strict';

const assert = require('assert');
const bs58 = require('bs58');
const crypto = require('crypto');

// While our "inner tokens" are sufficient to validate a session, they require a
// database lookup to do so. This outer envelope wraps the inner token in an
// authenticity signature that can be verified without a network hop. Since its
// only purpose is to cut down on spamming the database, we limit the signature
// to 32-bits, which should be plenty to reduce noise and identify bad actors
// for blacklisting purposes.
module.exports = {
    sign: (data, config) => {
        const [secretIdStr, { secret: secretStr }] =
                Object.entries(config.signingKeys)
                        .find(([sid, s]) => s.default);

        const secretBuf = bs58.decode(secretStr);

        const signature = crypto.createHmac('sha256', secretBuf).update(data)
                .digest().slice(0, 4);

        if (data.length > 65535) {
            throw new Error('Data too long.');
        }

        const dataLength = Buffer.alloc(2);
        dataLength.writeUInt16BE(data.length);

        const secretIdBuf = Buffer.from(secretIdStr, 'utf8');

        if (secretIdBuf.length > 255) {
            throw new Error('Signing key id too long: ' + secretIdStr);
        }

        const secretIdLength = Buffer.alloc(1);
        secretIdLength.writeUInt8(secretIdBuf.length);

        return Buffer.concat([
            Buffer.from([0]),
            dataLength,
            data,
            secretIdLength,
            secretIdBuf,
            signature
        ]);
    },
    verifyAndOpen(envelope, config) {
        assert.equal(envelope.readUInt8(0), 0);

        const dataLength = envelope.readUInt16BE(1);
        const data = envelope.slice(3, 3 + dataLength);

        const secretIdLength = envelope.readUInt8(3 + dataLength);
        const secretId =
                envelope.slice(4 + dataLength, 4 + dataLength + secretIdLength)
                .toString('utf8');

        if (!config.signingKeys[secretId]) {
            throw new Error();
        }

        const actualSignature = envelope.slice(4 + dataLength + secretIdLength);
        const expectedSignature =
                crypto.createHmac(
                        'sha256',
                        bs58.decode(config.signingKeys[secretId].secret))
                    .update(data).digest().slice(0, 4);

        if (!actualSignature.equals(expectedSignature)) {
            throw new Error();
        }

        return data;
    }
};
