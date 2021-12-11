'use strict';

const crypto = require('crypto');
const errors = require('../standard-errors');
const generateId = require('../utils/generate-id');
const PageableCollectionOrder = require('../utils/PageableCollectionOrder');
const yup = require('yup');

module.exports = class RealmsService {
    constructor(dbClient, nower) {
        this.dbClient = dbClient;
        this.nower = nower;

        this.byCreationTime = new PageableCollectionOrder(
                'createdAt',
                this.dbClient.collection('Realms'),
                [['createdAt', 1]]);
    }

    async create(friendlyName, userSpecifierSet) {
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
