'use strict';

const crypto = require('crypto');
const errors = require('../standard-errors');
const generateId = require('../utils/generate-id');
const Joi = require('joi');
const PageableCollectionOrder = require('../utils/PageableCollectionOrder');

module.exports = class RealmsService {
    constructor(dbClient, { nower }) {
        this.dbClient = dbClient;
        this.nower = nower;

        this.byCreationTime = new PageableCollectionOrder(
                'createdAt',
                this.dbClient.collection('Realms'),
                [['createdAt', 1]]);
    }

    async create(friendlyName, userSpecifierSet) {
        Joi.assert({
            friendlyName,
            userSpecifierSet
        }, Joi.object({
            friendlyName: Joi.string().required().min(0).max(100),
            userSpecifierSet:
                    Joi.array().required().items(Joi.string().min(1).max(100))
        }).strict());

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
        Joi.assert(id, Joi.string().required());

        return this.dbClient.collection('Realms').findOne({ _id: id });
    }
};
