'use strict';

const util = require('util');

module.exports = repeater => {
    const lines = [];

    const result = (...args) => {
        repeater(...args);

        let result = '';
        for (const a of args) {
            if (result.length !== 0) {
                result += ' ';
            }

            result += util.inspect(a, false, null);
        }

        for (const line of result.split('\n')) {
            lines.push(line);
        }
    };

    result.grep = query => lines.filter(line => line.includes(query));

    return result;
}
