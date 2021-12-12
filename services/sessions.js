'use strict';

const crypto = require('crypto');
const errors = require('../standard-errors');
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
        this.currentAccessSecret = bs58.decode(mongoDoc.acceptedAccessNonce);
        this.currentRefreshSecret = bs58.decode(mongoDoc.acceptedRefreshNonce);
        this.agentFingerprint = mongoDoc.agentFingerprint;
        this.creationTime = mongoDoc.creationTime;
        this.currentGenerationCreationAt =
                mongoDoc.currentGenerationCreationAt;
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
            currentAccessSecret: bs58.encode(s.acceptedAccessNonce),
            currentRefreshSecret: bs58.encode(s.acceptedRefreshNonce),
            agentFingerprint: s.agentFingerprint,
            creationTime: s.creationTime,
            currentGenerationCreationAt: s.currentGenerationCreationAt,
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
    constructor(dbClient, nower) {
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

    async create(realmId, agentFingerprint, /* nullable */ userId) {
        const id = generateId('sid');
        const now = new Date(this.nower());

        const session = new Session({
            _id: id,
            currentAccessSecret: bs.encode(crypto.randomBytes(32)),
            currentRefreshSecret: bs.encode(crypto.randomBytes(32)),
            agentFingerprint,
            createdAt: now,
            currentGenerationCreationAt: now,
            currentGenerationNumber: 0,
            lastUsedAt: now,
            nextGenAuthenticityKey: bs.encode(crypto.randomBytes(32)),
            nextGenAccessTokenPad: bs.encode(crypto.randomBytes(32)),
            nextGenRefreshTokenPad: bs.encode(crypto.randomBytes(32)),
            realmId,
            userId
        });

        await this.mongoCollection.insert(session.toMongoDoc());

        return {
            accessSecret: session.accessSecret,
            accessSecretSignature:
                    sign(session.accessSecret, session.nextGenAuthenticityKey),
            id: session.id,
            refreshSecret: session.refreshSecret,
            refreshSecretSignature:
                    sign(session.refreshSecret, session.nextGenAuthenticityKey)
        };;
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

    async validateAccessToken(
            realmId, sessionId, accessSecret, agentFingerprint) {

        let session = await findWithMatchingFingerprintOrInvalidate(
                this, realmId, sid, agentFingerprint);

        if (session.currentAccessSecret !== accessSecret) {
            // This isn't our current access secret. Is it maybe a next-gen
            // one?
            verify(accessSecret, session.nextGenAuthenticityKey);

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
        agentFingerprint
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
    return crypto.createHmac('sha256').update(text).digest();
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
    if (!crypto.createHmac('sha256').update(text).digest()
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
