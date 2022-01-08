'use string';

const bs58 = require('bs58');
const validate = require('./utils/soul-validate');

const jwksAlternativeFields = ['literal', 'uri'];

module.exports = async serviceConfig => await validate(serviceConfig,
        check => check.object({
    audienceId: check.string({ maxLength: 1000 }),
    jwks: check.object({}, {
        unknownEntries: {
            key: check.string({ maxLength: 1000 }),
            value: [
                check.object(),
                (check, actual) => {
                    const defined = [];

                    for (const key of Object.keys(actual)) {
                        if (jwksAlternativeFields.includes(key)) {
                            defined.push(key);
                        }
                    }

                    if (defined.length !== 1) {
                        throw new check.ValidationError(`must define exactly `
                                + `one of {${jwksAlternativeFields}}, but `
                                + `these were defined: ${defined}`, actual);
                    }
                },
                {
                    literal: check.optional({
                        keys: check.array({
                            elements: check.object()
                        })
                    }),
                    uri: check.optional(check.string({ maxLength: 1000 }))
                }
            ]
        }
    }),
    signingSecret: (check, actual) => {
        try {
            const buffer = bs58.decode(actual);

            if (buffer.length != 32) {
                throw check.validationError(
                        'isn\'t a base58 encoding of exactly 32 bytes',
                        actual);
            }
        }
        catch (e) {
            throw new check.ValidationError('isn\'t base58 encoded', actual, e);
        }
    }
}));
