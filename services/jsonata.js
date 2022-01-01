'use strict';

const jsonata = require('jsonata');
const LRU = require('lru-cache');
const ms = require('ms');

module.exports = class JsonataService {
    constructor({ nower }) {
        this.cache = new LRU({
            max: 100,
            maxAge: ms('24h'),
            updateAgeOnGet: true
        });
        this.nower = nower;
    }

    evaluate(src, input) {
        const compiledFn = this.cache.get(src) || jsonata(src);
        this.cache.set(src, compiledFn);

        return new Promise((resolve, reject) => compiledFn.evaluate(input, {
            now: this.nower(),
            ms
        }, (err, result) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(result);
            }
        }));
    }
};
