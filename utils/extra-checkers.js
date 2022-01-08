'use strict';

const typeIs = require('type-is');

module.exports = {
    agentFingerprint() {
        return (check, actual) => {
            check.appendSchema(check.string({ minLength: 0, maxLength: 1000 }));
        };
    },
    contentType(specifiers) {
        if (!Array.isArray(specifiers)) {
            specifiers = [specifiers];
        }

        return async (check, actual) => {
            if (!typeIs.is(actual, specifiers)) {
                throw new check.ValidationError('must be one of: ' + specifiers,
                        actual);
            }
        };
    },
    friendlyDuration() {
        return (check, actual) => {
            check.appendSchema(check.string({
                regexp: /^\d{1,15}(?:ms|s|m|h|d|y)$/
            }));
        };
    },
    jsonPatch() {
        return (check, actual) => check.array({
            elements: [
                { path: check.string() },
                check.switch(
                    actual => actual.op,
                    {
                        add: { value: check.defined() },
                        copy: { from: check.string() },
                        move: { from: check.string() },
                        remove: {},
                        replace: { value: check.defined() },
                        test: { value: check.defined() }
                    }
                )
            ]
        });
    },
    securityContextName() {
        return (check, actual) => {
            check.appendSchema(check.string({ regexp: /^\w{1,50}$/ }));
        };
    },
    sessionToken() {
        return (check, actual) => {
            check.appendSchema(check.string({ minLength: 1, maxLength: 1000 }));
        };
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
                throw new this.ValidationError('id too long', actual);
            }

            const c = '[A-Za-z0-9]';
            if (!new RegExp(`^${c}+_${c}+$`).test(actual)) {
                throw new this.ValidationError(`not id shaped`, actual);
            }
        };
    },
    versionedSecurityContextName() {
        return (check, actual) => {
            check.appendSchema(check.string({ regexp: /^\w{1,50}:\d{1,15}$/ }));
        };
    }
};
