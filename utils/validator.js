'use strict';

const lodash = require('lodash');
const util = require('util');

class ValidationError extends Error {
    code = 'VALIDATION_ERROR';
    path = [];

    constructor(msg, actual) {
        super(msg);

        this.actualValue = actual;
    }
}

// Oh how I hate my existing validation options...

class ValidationContext {
    stack = [];
    state = {
        additionalSchemas: [],
        unknownFieldSchemas: []
    };

    constructor(checkerTemplate, hierarchyGlobalSchemas = []) {
        this.checker = {};

        for (const [methodName, method] of Object.entries(checkerTemplate)) {
            this.checker[methodName] = method.bind(this.checker);
        }

        this.checker.appendSchema = s => {
            this.additionalSchemas.push(s);
        };

        this.checker.appendUnknownFieldSchemas = ({ key, value }) => {
            this.unknownFieldSchemas.push({ key, value });
        }

        this.checker.appendHierarchyGlobalSchema = s => {
            this.hierarchyGlobalSchemas.push(s);
        };

        this.checker.path = [];
        this.checker.ValidationError = ValidationError;

        this.checker._ctx = this;

        this.state.hierarchyGlobalSchemas = [...hierarchyGlobalSchemas];
        this.state.globalSchemas = [...hierarchyGlobalSchemas];

        Object.assign(this, this.state);
    }

    push(key) {
        this.stack.push({
            key,
            oldState: this.state
        });

        this.checker.path.push(key);

        this.state = {
            additionalSchemas: [],
            hierarchyGlobalSchemas: [],
            globalSchemas: [ ...this.hierarchyGlobalSchemas ]
        };

        Object.assign(this, this.state);
    }

    pop() {
        this.checker.path.pop();

        const { oldState } = this.stack.pop();
        this.state = oldState;

        Object.assign(this, this.state);
    }
}

module.exports = async (value, schema, checkerExtensions) => {
    const ctx = new ValidationContext({
        ...defaultChecker,
        ...checkerExtensions
    });

    await validate(value, schema, ctx);
};

module.exports.ValidationError = ValidationError;

async function validate(value, schemas, ctx) {
    if (!Array.isArray(schemas)) {
        schemas = [schemas];
    }

    schemas.unshift(ctx.globalSchemas);

    let someObjectSchema = false;
    const uberObjectSchema = {};

    while (schemas.length > 0) {
        const schema = schemas.shift();

        if (Array.isArray(schema)) {
            for (const s of schema) {
                schemas.push(s);
            }

            continue;
        }

        const typeofS = typeof schema;
        switch (typeofS) {
            case 'function': {
                const next = await schema(ctx.checker, value);

                if (next) {
                    schemas.push(next);
                }

                while (ctx.additionalSchemas.length > 0) {
                    schemas.push(ctx.additionalSchemas.shift());
                }

                break;
            }
            case 'object': {
                someObjectSchema = true;

                for (const [key, subSchema] of Object.entries(schema)) {
                    if (!uberObjectSchema[key]) {
                        uberObjectSchema[key] = [];
                    }

                    uberObjectSchema[key].push(subSchema);
                }
                break;
            }
            default: {
                throw new Error('Not a valid schema: ' + util.inspect(schema));
            }
        }
    }

    if (someObjectSchema && (value === undefined || value === null)) {
        throw new ValidationError('invalid undefined or null', value);
    }

    const unvisitedFields = new Set(Object.keys(
            value && typeof value !== 'string' ? value : {}));

    for (const [key, subSchema] of Object.entries(uberObjectSchema)) {
        try {
            unvisitedFields.delete(key);
            ctx.push(key);
            await validate(value[key], subSchema, ctx);
            ctx.pop();
        }
        catch (e) {
            if (e instanceof ValidationError) {
                e.path.unshift(key);
            }

            throw e;
        }
    }

    for (const f of unvisitedFields) {
        unvisitedFields.delete(f);

        const keySchemas = [];
        const valueSchemas = [];
        for (const { key, value } of ctx.unknownFieldSchemas) {
            keySchemas.push(key);
            valueSchemas.push(value);
        }

        await validate(f, keySchemas, ctx);

        ctx.push(f);
        ctx.checker.unknown = true;
        await validate(value[f], valueSchemas, ctx);
        delete ctx.checker.unknown;
        ctx.pop();
    }
}

const arrayOpts = {
    elements: () => {},
    maxLength: (max, arr) => {
        if (arr.length >= max) {
            throw new ValidationError(`greater than ${max} characters`,
                    arr.length);
        }
    },
    minLength: (min, arr) => {
        if (arr.length <= min) {
            throw new ValidationError(`fewer than ${min} characters`,
                    arr.length);
        }
    }
};

const numberOpts = {
    max: (max, num) => {
        if (num > max) {
            throw new ValidationError(`greate than ${max}, the maximum`, num);
        }
    },
    min: (min, num) => {
        if (num < min) {
            throw new ValidationError(`less than ${min}, the minimum`, num);
        }
    }
};

const stringOpts = {
    maxLength: (max, str) => {
        if (str.length > max) {
            throw new ValidationError(`greater than ${max} characters`,
                    arr.length);
        }
    },
    minLength: (min, str) => {
        if (str.length < min) {
            throw new ValidationError(`fewer than ${min} characters`,
                    arr.length);
        }
    },
    regexp: (r, str) => {
        if (!r.test(str)) {
            throw new ValidationError(`doesn't match regexp: ${r.source}`);
        }
    }
};

var defaultChecker = {
    array(opts = {}) {
        return async (check, actual) => {
            if (!Array.isArray(actual)) {
                throw new ValidationError('not an array', actual);
            }

            for (const [key, optValue] of Object.entries(opts)) {
                await arrayOpts[key](optValue, actual);
            }

            if (opts.elements) {
                const s = {};

                for (let i = 0; i < actual.length; i++) {
                    s[i] = opts.elements;
                }

                this.appendSchema(s);
            }
        };
    },
    boolean() {
        return async (check, actual) => {
            if (typeof actual !== 'boolean') {
                throw new ValidationError('not a boolean', actual);
            }
        };
    },
    invalid(message) {
        return (check, actual) => {
            throw new ValidationError(message, actual)
        };
    },
    number(opts) {
        return async (check, actual) => {
            if (typeof actual !== 'number') {
                throw new ValidationError('not a number', actual);
            }

            for (const [key, optValue] of Object.entries(opts)) {
                await numberOpts[key](optValue, actual);
            }
        };
    },
    object(shape, opts) {
        return async (check, actual) => {
            if (typeof actual !== 'object') {
                throw new ValidationError('not an object', actual);
            }

            check.appendSchema(shape);

            if (opts.unknownEntries) {
                check.appendUnknownFieldSchemas(opts.unknownEntries);
            }
        };
    },
    optional(nextSchema) {
        return (check, actual) => {
            if (actual !== undefined) {
                check.appendSchema(nextSchema);
            }
        };
    },
    string(opts = {}) {
        return async (check, actual) => {
            if (typeof actual !== 'string') {
                throw new ValidationError('not an string', actual);
            }

            for (const [key, optValue] of Object.entries(opts)) {
                await stringOpts[key](optValue, actual);
            }
        };
    },
    switch(distinguisher, alternatives = {}, onNoMatch = () => {}) {
        return async (check, actual) => {
            const key = await distinguisher(actual);

            if (!alternatives[key]) {
                if (onNoMatch) {
                    this.appendSchema(onNoMatch);
                }
                else {
                    throw new ValidationError('validation failed');
                }
            }

            this.appendSchema(alternatives[key]);
        };
    },
    union(...alternatives) {
        return async (check, actual) => {
            // Ineffecient, but we must.

            let success;
            let message = '';

            for (const a of alternatives) {
                try {
                    await validate(actual, a, check._ctx);
                    success = true;
                }
                catch (e) {
                    if (message !== '') {
                        message += ' and ';
                    }

                    message += e.message;
                }
            }

            if (!success) {
                throw new check.ValidationError(message, actual);
            }
        };
    }
};
