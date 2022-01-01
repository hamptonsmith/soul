'use strict';

const lodash = require('lodash');

module.exports = (predicate, target) => {
    if (typeof predicate === 'string') {
        predicate = JSON.parse(predicate);
    }

    return testPredicate(predicate, target);
}

const operators = {
    equals: ([key, val, defaultVal], target) => {
        return lodash.get(target, key, defaultVal) === val;
    },
    every: (args, target) => {
        return args
                .map(arg => testPredicate(arg, target))
                .every(arg => !!arg);
    },
    regexp: ([key, regexp, defaultVal], target) => {
        return new RegExp(regexp).test(lodash.get(target, key, defaultVal));
    },
    some: (args, target) => {
        return args
                .map(arg => testPredicate(arg, target))
                .some(arg => !!arg);
    }
};

function testPredicate(ast, target) {
    const [[ op, arg ]] = Object.entries(ast);

    return !!operators[op](arg, target);
}
