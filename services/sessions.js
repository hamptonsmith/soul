'use strict';

const crypto = require('crypto');
const errors = require('../standard-errors');
const generateId = require('../utils/generate-id');

module.exports = class SessionsService {
    constructor(dbClient) {
        this.dbClient = dbClient;
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

    async getSessionWithFingerprintOrInvalidate(sessionId, agentFingerprint) {
        const sessionData = await this.dbClient.collecion('Sessions').findOne({
            _id: sessionId,
            agentFingerprint
        });

        if (!sessionData) {
            await this dbClient.collection('Sessions').deleteAll({
                _id: sessionId
            });

            throw errors.noSuchSession(sessionId);
        }

        return sessionData;
    }
};
