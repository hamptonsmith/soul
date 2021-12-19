'use strict';

const bs58 = require('bs58');
const crypto = require('crypto');
const errors = require('../standard-errors');
const Joi = require('joi');
const generateId = require('../utils/generate-id');
const ms = require('ms');
const PageableCollectionOrder = require('../utils/PageableCollectionOrder');
const SbError = require('@shieldsbetter/sberror2');

const { DateTime } = require('luxon');

class BadSignature extends SbError {
    static messageTemplate =
            'Signature {{signature}} is invalid for data {{data}}.';
}

module.exports = class SessionsService {
    constructor(dbClient, { doBestEffort, nower }) {
        this.doBestEffort = doBestEffort;
        this.mongoCollection = dbClient.collection('Sessions');
        this.nower = nower;

        this.byCreationTime = new PageableCollectionOrder(
                'createdAt',
                this.mongoCollection,
                [['createdAt', 1]],
                fromMongoDoc,
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

        const session = {
            currentEraSecret: crypto.randomBytes(32),
            agentFingerprint,
            createdAt: now,
            currentEraStartedAt: now,
            currentEraNumber: 0,
            id: id,
            lastUsedAt: now,
            nextEraAuthenticityKey: crypto.randomBytes(32),
            realmId,
            userId
        };

        await this.mongoCollection.insertOne(toMongoDoc(session));

        return {
            eraCredentials: {
                index: 0,
                secret: session.currentEraSecret,

                // Here we're returning the current era's secret, whose use in a
                // session token requires only knowing the secret, hence the
                // signature is irrelevant. There is no "current generation
                // authenticity key" and thus even if we -wanted- to sign this
                // thing, there's nothing sensible to sign it with. We go ahead
                // and return some random bytes just to keep things mostly
                // consistent. After all, since we don't know what the current
                // generation's signing key hypothetically "might have been",
                // these bytes could well be the signature...
                signature: crypto.randomBytes(32)
            },

            ...session
        };
    }

    async refresh(realmId, sid, agentFingerprint, accessSecret, signature) {
        throw new Error('not implemented');
    }

    async validateSessionToken(
            realmId, sessionId, eraCredentials, agentFingerprint, config) {

        let nextEraCredentials;
        let session = await findWithMatchingFingerprintOrInvalidate(
                this, realmId, sessionId, agentFingerprint);

        const now = DateTime.fromJSDate(new Date(this.nower()));
        switch (eraCredentials.index - session.currentEraNumber) {
            case -1: {
                // The user has presented a token from the last era.

                if (session.previousEraSecret
                        && eraCredentials.secret.equals(
                                session.previousEraSecret)) {
                    const gracePeriodMs = ms(
                            session.tokenGracePeriodDuration
                            || config.defaultSessionTokenGracePeriodDuration);

                    const acceptableUntil =
                            DateTime.fromJSDate(session.currentEraStartedAt)
                            .plus(gracePeriodMs);

                    if (now > acceptableUntil) {
                        throw new Error();
                    }
                }

                break;
            }
            case 0: {
                // The user has presented a token from the current era.

                if (!eraCredentials.secret.equals(session.currentEraSecret)) {
                    throw new Error();
                }

                const eraDuration = ms(
                        session.tokenEraDuration
                        || config.defaultSessionTokenEraDuration);

                const sunsetsAt =
                        DateTime.fromJSDate(session.currentEraStartedAt)
                        .plus(eraDuration);

                if (now >= sunsetsAt) {
                    // These credentials are fine, but this era is sunsetting,
                    // so let's suggest some next-era credentials.

                    const nextEraSecret = crypto.randomBytes(32);
                    nextEraCredentials = {
                        index: session.currentEraNumber + 1,
                        secret: nextEraSecret,
                        signature: sign(
                                nextEraSecret, session.nextEraAuthenticityKey)
                    };
                }

                break;
            }
            case 1: {
                // The user has presented a token from the next era.

                verify(eraCredentials.secret, eraCredentials.signature,
                        session.nextEraAuthenticityKey);

                session = await advanceEra(this, session,
                        session.currentEraSecret, eraCredentials.secret);

                break;
            }
            default: {
                throw new Error();
            }
        }

        await this.doBestEffort(
                this.mongoCollection.updateOne({
                    _id: sessionId,
                    lastUsedAt: { $lt: now }
                }, {
                    $set: { lastUsedAt: now }
                });

        return {
            ...session,

            nextEraCredentials
        };
    }
};

async function advanceEra(sessions, session, oldSecret, newSecret) {
    const where = {
        _id: { $eq: session.id },

        // Make sure somebody else hasn't accepted a refresh key and advanced
        // era in the mean time.
        currentEraNumber: { $eq: session.currentEraNumber }
    };

    const now = new Date(sessions.nower());

    const update = {
        $set: {
            currentEraSecret: bs58.encode(newSecret),
            currentEraStartedAt: now,
            currentEraNumber: currentEraNumber + 1,
            lastUsedAt: now,
            nextEraAuthenticityKey: bs58.encode(crypto.randomBytes(32)),
            previousEraSecret: bs58.encode(oldSecret)
        }
    };

    await sessions.mongoCollection.updateOne(where, update);

    return fromMongoDoc({
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

    return fromMongoDoc(sessionData);
}

function fromMongoDoc(d) {
    return {
        agentFingerprint: d.agentFingerprint,
        currentEraSecret: bs58.decode(d.currentEraSecret),
        createdAt: d.createAt,
        currentEraStartedAt: d.currentEraStartedAt,
        currentEraNumber: d.currentEraNumber,
        lastUsedAt: d.lastUsedAt,
        id: d._id,
        nextEraAuthenticityKey: bs58.decode(d.nextEraAuthenticityKey),
        realmId: d.realmId,
        userId: d.userId
    };
}

function sign(text, secret) {
    return crypto.createHmac('sha256', secret).update(text).digest();
}

function toMongoDoc(o) {
    return {
        _id: o.id,
        agentFingerprint: o.agentFingerprint,
        currentEraSecret: bs58.encode(o.currentEraSecret),
        createdAt: o.createAt,
        currentEraStartedAt: o.currentEraStartedAt,
        currentEraNumber: o.currentEraNumber,
        lastUsedAt: o.lastUsedAt,
        nextEraAuthenticityKey: bs58.encode(o.nextEraAuthenticityKey),
        realmId: o.realmId,
        userId: o.userId
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
