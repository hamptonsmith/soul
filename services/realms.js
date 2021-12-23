'use strict';

const crypto = require('crypto');
const errors = require('../standard-errors');
const generateId = require('../utils/generate-id');
const PageableCollectionOrder = require('../utils/PageableCollectionOrder');
const validate = require('../utils/validator');

module.exports = class RealmsService {
    constructor(dbClient, { nower }) {
        this.dbClient = dbClient;
        this.nower = nower;

        this.byCreationTime = new PageableCollectionOrder(
                'createdAt',
                this.dbClient.collection('Realms'),
                [['createdAt', 1]],
                d => {
                    d.id = d._id;
                    delete d._id;
                    return d;
                });
    }

    async create(friendlyName, userSpecifierSet) {
        await validate(friendlyName, check => check.string({
            minLength: 0,
            maxLength: 100
        }));

        await validate(userSpecifierSet, check => check.array({
            elements: check.string({
                minLength: 1,
                maxLength: 100
            })
        }));

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

    async fetchById(id) {
        await validate(
                id, check => check.string({ minLength: 1, maxLength: 100 }));

        return this.dbClient.collection('Realms').findOne({ _id: id });
    }
};
