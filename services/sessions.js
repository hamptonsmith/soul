'use strict';

const bs58 = require('bs58');
const crypto = require('crypto');
const errors = require('../standard-errors');
const Joi = require('joi');
const generateId = require('../utils/generate-id');
const PageableCollectionOrder = require('../utils/PageableCollectionOrder');
const SbError = require('@shieldsbetter/sberror2');
const xorLib = require('buffer-xor');

class BadSignature extends SbError {
    static messageTemplate =
            'Signature {{signature}} is invalid for data {{data}}.';
}

class Session {
    constructor(mongoDoc) {
        this.currentAccessSecret = bs58.decode(mongoDoc.currentAccessSecret);
        this.currentRefreshSecret = bs58.decode(mongoDoc.currentRefreshSecret);
        this.agentFingerprint = mongoDoc.agentFingerprint;
        this.createdAt = mongoDoc.createdAt;
        this.currentGenerationCreatedAt =
                mongoDoc.currentGenerationCreatedAt;
        this.currentGenerationNumber = mongoDoc.currentGenerationNumber;
        this.lastUsedAt = mongoDoc.lastUsedAt;
        this.id = mongoDoc._id;
        this.nextGenAuthenticityKey =
                bs58.decode(mongoDoc.nextGenAuthenticityKey);
        this.nextGenAccessTokenPad =
                bs58.decode(mongoDoc.nextGenAccessTokenPad);
        this.nextGenRefreshTokenPad =
                bs58.decode(mongoDoc.nextGenRefreshTokenPad);
        this.realmId = mongoDoc.realmId;
        this.userId = mongoDoc.userId;
    }

    signForNextGeneration(data) {
        return sign(data, this.nextGenAuthenticityKey);
    }

    static toMongoDoc(s) {
        return {
            _id: s.id,
            currentAccessSecret: bs58.encode(s.currentAccessSecret),
            currentRefreshSecret: bs58.encode(s.currentRefreshSecret),
            agentFingerprint: s.agentFingerprint,
            createdAt: s.createdAt,
            currentGenerationCreatedAt: s.currentGenerationCreatedAt,
            currentGenerationNumber: s.currentGenerationNumber,
            lastUsedAt: s.lastUsedAt,
            nextGenAuthenticityKey: bs58.encode(s.nextGenAuthenticityKey),
            nextGenAccessTokenPad: bs58.encode(s.nextGenAccessTokenPad),
            nextGenRefreshTokenPad: bs58.encode(s.nextGenRefreshTokenPad),
            realmId: s.realmId,
            userId: s.userId
        };
    }

    toMongoDoc() {
        return Session.toMongoDoc(this);
    }
}

module.exports = class SessionsService {
    constructor(dbClient, { nower }) {
        this.mongoCollection = dbClient.collection('Sessions');
        this.nower = nower;

        this.byCreationTime = new PageableCollectionOrder(
                'createdAt',
                this.mongoCollection,
                [['createdAt', 1]],
                {
                    realmId: (query, value) => {
                        query.realmId = { $eq: value };
                    }
                });
    }

    async create(
            realmId, /* nullable */ agentFingerprint, /* nullable */ userId) {
        Joi.assert({
            agentFingerprint,
            realmId,
            userId
        }, Joi.object({
            agentFingerprint: Joi.string().optional().min(0).max(1000),
            realmId: Joi.string().required().min(0).max(100),
            userId: Joi.string().optional().min(0).max(100)
        }).strict());

        const id = generateId('sid');
        const now = new Date(this.nower());

        const session = new Session({
            _id: id,
            currentAccessSecret: bs58.encode(crypto.randomBytes(32)),
            currentRefreshSecret: bs58.encode(crypto.randomBytes(32)),
            agentFingerprint,
            createdAt: now,
            currentGenerationCreatedAt: now,
            currentGenerationNumber: 0,
            lastUsedAt: now,
            nextGenAuthenticityKey: bs58.encode(crypto.randomBytes(32)),
            nextGenAccessTokenPad: bs58.encode(crypto.randomBytes(32)),
            nextGenRefreshTokenPad: bs58.encode(crypto.randomBytes(32)),
            realmId,
            userId
        });

        await this.mongoCollection.insertOne(session.toMongoDoc());

        return {
            accessSecret: session.currentAccessSecret,
            accessSecretSignature: crypto.randomBytes(32),
            id: session.id,
            refreshSecret: session.currentRefreshSecret,
            refreshSecretSignature: crypto.randomBytes(32)
        };
    }

    async refresh(realmId, sid, agentFingerprint, refreshSecret, signature) {
        let session = await findWithMatchingFingerprintOrInvalidate(
                this, realmId, sid, agentFingerprint);

        if (session.currentRefreshSecret !== refreshSecret) {
            // This isn't our current refresh secret. Is it maybe a next-gen
            // one?
            verify(refreshSecret, session.nextGenAuthenticityKey);

            // It is! Let's advance generations so we can issue a next,
            // NEXT-generation token.
            session = await advanceGeneration(
                    this,
                    session,
                    sid,
                    refreshSecret,
                    xor(
                        xor(
                            refreshSecret,
                            session.nextGenRefreshTokenPad),
                        session.nextGenAccessTokenPad));
        }

        const secretNonce = crypto.randomBytes(32);
        const newAccessSecret = xor(secretNonce, session.nextGenAccessTokenPad);
        const newRefreshSecret =
                xor(secretNonce, session.nextGenRefreshTokenPad);

        // Next-generation credentials.
        return {
            accessSecret: newAccessSecret,
            accessSecretSignature:
                    sign(newAccessSecret, session.nextGenAuthenticityKey),
            refreshSecret: newRefreshSecret,
            refreshSecretSignature:
                    sign(newRefreshSecret, session.nextGenAuthenticityKey)
        };
    }

    async validateAccessToken(realmId, sessionId, accessSecret, accessSignature,
            agentFingerprint) {

        let session = await findWithMatchingFingerprintOrInvalidate(
                this, realmId, sessionId, agentFingerprint);

        if (!session.currentAccessSecret.equals(accessSecret)) {
            // This isn't our current access secret. Is it maybe a next-gen
            // one?
            verify(accessSecret, accessSignature,
                    session.nextGenAuthenticityKey);

            // It is! Let's advance generations.
            session = await advanceGeneration(
                    this,
                    session,
                    sessionId,
                    xor(
                        xor(
                            accessSecret,
                            session.nextGenAccessTokenPad
                        ),
                        session.nextGenRefreshTokenPad),
                    accessSecret);
        }

        return session;
    }
};

async function advanceGeneration(
        sessions, session, refreshSecret, accessSecret) {

    const where = {
        _id: { $eq: session.id },

        // Make sure somebody else hasn't accepted a refresh key and advanced
        // generation in the mean time.
        currentGenerationNumber: { $eq: session.currentGenerationNumber }
    };

    const now = new Date(sessions.nower());

    const update = {
        $set: {
            currentAccessSecret: bs58.encode(accessSecret),
            currentGenerationCreatedAt: now,
            currentGenerationNumber: currentGenerationNumber + 1,
            currentRefreshSecret: bs58.encode(refreshSecret),
            lastUsedAt: now,
            nextGenAuthenticityKey: bs58.encode(crypto.randomBytes(32)),
            nextGenAccessTokenPad: bs58.encode(crypto.randomBytes(32)),
            nextGenRefreshTokenPad: bs58.encode(crypto.randomBytes(32))
        }
    };

    await sessions.mongoCollection.updateOne(where, update);

    return new Session({
        ...session.toMongoDoc(),
        ...update.$set
    });
}

async function findWithMatchingFingerprintOrInvalidate(
        sessions, realmId, sessionId, agentFingerprint) {
    const sessionData = await sessions.mongoCollection.findOne({
        _id: sessionId,
        realmId,
        agentFingerprint: { $in: [null, agentFingerprint] }
    });

    if (!sessionData) {
        await sessions.mongoCollection.deleteAll({
            _id: sessionId
        });

        throw errors.noSuchSession(sessionId);
    }

    return new Session(sessionData);
}

function sign(text, secret) {
    console.log('sign', text, secret);
    return crypto.createHmac('sha256', secret).update(text, 'utf8').digest();
}

function toMongoDoc(o) {
    return result = {
        _id: o.id,
        currentAccessSecret: bs58.encode(o.acceptedAccessNonce),
        currentRefreshSecret: bs58.encode(o.acceptedRefreshNonce),
        agentFingerprint: o.agentFingerprint,
        creationTime: o.creationTime,
        currentGenerationCreationAt: o.currentGenerationCreationAt,
        currentGenerationNumber: o.currentGenerationNumber,
        lastUsedAt: o.lastUsedAt,
        nextGenAuthenticityKey: bs58.encode(o.nextGenAuthenticityKey),
        nextGenAccessTokenPad: bs58.encode(o.nextGenAccessTokenPad),
        nextGenRefreshTokenPad: bs58.encode(o.nextGenRefreshTokenPad),
        realmId: o.realmId,
        userId: o.userId
    };
}

function fromMongoDoc(d) {
    return {
        currentAccessSecret: bs58.decode(d.acceptedAccessNonce),
        currentRefreshSecret: bs58.decode(d.acceptedRefreshNonce),
        agentFingerprint: d.agentFingerprint,
        creationTime: d.creationTime,
        currentGenerationCreationAt: d.currentGenerationCreationAt,
        currentGenerationNumber: d.currentGenerationNumber,
        id: d._id,
        lastUsedAt: d.lastUsedAt,
        nextGenAuthenticityKey: bs58.decode(d.nextGenAuthenticityKey),
        nextGenAccessTokenPad: bs58.decode(d.nextGenAccessTokenPad),
        nextGenRefreshTokenPad: bs58.decode(d.nextGenRefreshTokenPad),
        realmId: d.realmId
    };
}

function verify(text, signature, secret) {
    if (!crypto.createHmac('sha256', secret).update(text).digest()
            .equals(signature)) {
        throw new BadSignature({
            data: bs58.encode(text),
            signature: bs58.encode(signature)
        });
    }
}

function xor(b1, b2) {
    if (b1.length !== b2.length) {
        throw new Error('Buffers not of the same length.');
    }

    return xorLib(b1, b2);
}
