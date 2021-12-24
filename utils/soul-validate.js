'use strict';

const extraCheckers = require('./extra-checkers');
const validator = require('./validator');

module.exports = (actual, schema) => validator(actual, schema, extraCheckers);
