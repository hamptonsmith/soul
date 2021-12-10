'use strict';

const bs58 = require('bs58');
const crypto = require('crypto');

module.exports = function generateId(prefix) {
    return `${prefix}_${bs58.encode(crypto.randomBytes(32))}`;
}
