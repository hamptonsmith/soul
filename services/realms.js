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

    async create(friendlyName, owners, userSpecifierSet) {
        yup.string().min(0).max(100).validateSync(friendlyName);
        yup.array().of(yup.string()).validateSync(userSpecifierSet);
        yup.array().of(yup.string()).validateSync(owners);

        const now = new Date(this.nower());

        const id = generateId('rlm');

        const newDoc = {
            createdAt: now,
            friendlyName,
            owners,
            updatedAt: now,
            userSpecifierSet
        };

        await this.dbClient.collection('Realms')
                .insertOne({ _id: id, ... newDoc });

        return { id, ...newDoc };
    }

    async createSession(realmId, agentFingerprint) {
        const id = generateId('sid');
        const acceptedAccessNonce = crypto.randomBytes(32);
        const acceptedRefreshNonce = crypto.randomBytes(32);

        await this.dbClient.collection('Sessions').insert({
            _id: id,
            acceptedAccessNonce: bs58.encode(acceptedAccessNonce),
            acceptedRefreshNonce: bs58.encode(acceptedRefreshNonce),
            agentFingerprint,
            creationTime: new Date(),
            nextGenAccessKey: bs58.encode(crypto.randomBytes(32)),
            nextGenRefreshKey: bs58.encode(crypto.randomBytes(32)),
            realmId
        });

        return {
            acceptedAccessNonce,
            acceptedRefreshNonce,
            id
        };
    }
};
