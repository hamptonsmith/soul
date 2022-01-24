'use strict';

const jsonata = require('jsonata');
const LRU = require('lru-cache');
const ms = require('ms');

const standardLibrary = { ms };

module.exports = class JsonataService {
    constructor() {
        this.cache = new LRU({
            max: 100,
            maxAge: ms('24h'),
            updateAgeOnGet: true
        });
    }

    evaluate(src, input, ctx) {
        const compiledFn = this.cache.get(src) || jsonata(src);
        this.cache.set(src, compiledFn);

        return new Promise((resolve, reject) => compiledFn.evaluate(
                input,
                { ...ctx, ...standardLibrary },
                (err, result) => err ? reject(err) : resolve(result)));
    }
};
