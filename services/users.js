'use strict';

const crypto = require('crypto');
const errors = require('../standard-errors');
const generateId = require('../utils/generate-id');
const PageableCollectionOrder = require('../utils/PageableCollectionOrder');
const yup = require('yup');

module.exports = class UsersService {
    constructor(dbClient, nower) {
        this.mongoCollection = dbClient.collection('Users');
        this.nower = nower;

        this.byCreationTime = new PageableCollectionOrder(
                'createdAt',
                this.dbClient.collection('Users'),
                [['createdAt', 1]],
                {
                    realmId: (query, value) => {
                        query.realmId = { $eq: value };
                    }
                });
    }

    async create(realmId, metadata = {}, { id = generateId('usr') } = {}) {
        yup.string().min(0).max(100).validateSync(friendlyName);
        yup.array().of(yup.string()).validateSync(userSpecifierSet);

        userSpecifierSet = [...new Set(userSpecifierSet)];

        const now = new Date(this.nower());

        const id = generateId('rlm');

        const newDoc = {
            createdAt: now,
            friendlyName,
            updatedAt: now,
            userSpecifierSet
        };

        await this.dbClient.collection('Realms')
                .insertOne({ _id: id, ... newDoc });

        return { id, ...newDoc };
    }
};

function validateMetadata(o) {
    let result;



    if (o === null) {
        throw n
    }
    if (Array.isArray(o)) {
        result = o.map(el => validateMetadata(el));
    }
    else if (typeof o === 'object') {
        result = {};
        for (const [key, value] of Object.entries(o)) {
            result[encodeURIComponent(key)] = encodeKeysAsUrlComponents
        }
    }
}
