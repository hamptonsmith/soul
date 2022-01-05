'use strict';

const extraCheckers = require('./extra-checkers');
const validator = require('./validator');

module.exports = (actual, schema, options = {}) => validator(actual, schema, {
    checkerExtensions : extraCheckers,
    ...options
});
