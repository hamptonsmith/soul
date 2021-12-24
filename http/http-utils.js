'use strict';

const jsonPointer = require('json-pointer');
const validate = require('../utils/validator');

module.exports = {
    async remapValidationErrorPaths(map, fn) {
        try {
            return await fn();
        }
        catch (e) {
            let cause = e;
            do {
                if (cause instanceof validate.ValidationError) {
                    const pathPtr = jsonPointer.compile(cause.path);

                    if (map[pathPtr]) {
                        cause.path = jsonPointer.parse(map[pathPtr]);
                    }
                }

                cause = cause.cause;
            } while (cause);

            throw e;
        }
    }
};
