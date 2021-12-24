'use strict';

module.exports = {
    agentFingerprint() {
        return (check, actual) => {
            check.appendSchema(check.optional(
                    check.string({ minLength: 0, maxLength: 1000 })));
        };
    },
    sessionToken() {
        return (check, actual) => {
            check.appendSchema(check.string({ minLength: 1, maxLength: 1000 }));
        }
    },
    soulId(prefix) {
        return (check, actual) => {
            if (typeof actual !== 'string') {
                throw new this.ValidationError('id not a string', actual);
            }

            if (prefix && !actual.startsWith(prefix + '_')) {
                throw new this.ValidationError(`not a ${prefix} id`, actual);
            }

            if (actual.length > 100) {
                throw new this.ValidatorError('id too long', actual);
            }

            const c = '[A-Za-z0-9]';
            if (!new RegExp(`^${c}+_${c}+$`).test(actual)) {
                throw new this.ValidatorError(`not id shaped`, actual);
            }
        };
    }
};
