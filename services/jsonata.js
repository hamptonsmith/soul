'use strict';

const errors = require('../standard-errors');
const jsonataLib = require('jsonata');
const LRU = require('lru-cache');
const ms = require('ms');
const SbError = require('@shieldsbetter/sberror2');

const standardLibrary = { ms };

class JsonataCompilationError extends SbError {
    static messageTemplate = 'Error compiling Jsonata code: {{{message}}}';
}

class JsonataRuntimeError extends SbError {
    static messageTemplate = 'Error running Jsonata code: {{{message}}}';
}

module.exports = class JsonataService {
    constructor({ jsonata = jsonataLib } = {}) {
        this.cache = new LRU({
            max: 100,
            maxAge: ms('24h'),
            updateAgeOnGet: true
        });
        this.jsonata = jsonata;
    }

    evaluate(src, input, ctx) {
        let compiledFn = this.cache.get(src);
        if (!compiledFn) {
            try {
                compiledFn = this.jsonata(src);
            }
            catch (e) {
                if (e.position === undefined) {
                    throw errors.unexpectedError(e);
                }

                throw new JsonataCompilationError({
                    message: e.message,
                    position: e.position,
                    token: e.token
                });
            }
        }

        this.cache.set(src, compiledFn);

        return new Promise((resolve, reject) => compiledFn.evaluate(
                input,
                { ...ctx, ...standardLibrary },
                (err, result) => err ? reject(err) : resolve(result)))
            .catch(e => {
                if (e.position === undefined) {
                    throw errors.unexpectedError(e);
                }

                throw new JsonataRuntimeError({
                    message: e.message,
                    position: e.position,
                    value: e.value
                }, e);
            });
    }
};
