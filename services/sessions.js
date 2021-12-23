'use strict';

const bs58 = require('bs58');
const crypto = require('crypto');
const errors = require('../standard-errors');
const generateId = require('../utils/generate-id');
const ms = require('ms');
const PageableCollectionOrder = require('../utils/PageableCollectionOrder');
const SbError = require('@shieldsbetter/sberror2');
const validate = require('../utils/validator');

const { DateTime } = require('luxon');

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
        validate({ realmId, agentFingerprint, userId }, check => ({
            realmId: check.string({ minLength: 0, maxLength: 100}),
            agentFingerprint: check.string({ minLength: 0, maxLength: 1000 }),
            userId: check.string({ minLength: 0, maxLength: 100 })
        }));

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

    async invalidateSession(realmId, sessionId, reason) {
        await this.mongoCollection.updateOne(
                { _id: sessionId },
                {
                    $set: {
                        invalidated: true,
                        invalidatedReason: reason
                    }
                });
    }

    async validateSessionToken(
            realmId, sessionId, eraCredentials, agentFingerprint, config) {

        let nextEraCredentials;
        let session = await findWithMatchingFingerprintOrInvalidate(
                this, realmId, sessionId, agentFingerprint);

        if (!session) {
            throw errors.invalidCredentials({
                reason: 'session expired, probably',
                relog: true
            });
        }

        if (session.invalidated) {
            throw errors.invalidCredentials({
                reason: 'session invalidated',
                relog: true
            });
        }

        const now = DateTime.fromJSDate(new Date(this.nower()));

        const expirationPeriodMs = ms(
                session.inactivityExpirationDuration
                || config.defaultSessionInactivityExpirationDuration);

        const expiresAt = DateTime.fromJSDate(session.lastUsedAt)
                .plus(expirationPeriodMs);

        if (now > expiresAt) {
            throw errors.invalidCredentials({
                reason: 'session expired',
                relog: true
            });
        }

        const tokenEraOffset = eraCredentials.index - session.currentEraNumber;
        if (tokenEraOffset < -1) {
            // Someone has presented a very old token.

            await this.doBestEffort('invalidate session (1)',
                    this.invalidateSession(realmId, sessionId,
                            'presented ancient token'));

            throw errors.invalidCredentials({
                prejudice: true,
                reason: 'ancient token'
            });
        }
        else if (tokenEraOffset === -1) {
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
                    throw errors.invalidCredentials({
                        reason: 'token expired',
                        retry: true
                    });
                }
            }
            else {
                await this.doBestEffort('invalidate session (1)',
                        this.invalidateSession(
                            realmId, sessionId,
                            'presented token from alternate timeline'
                        ));

                throw errors.invalidCredentials({
                    prejudice: true,
                    reason: 'bad secret'
                });
            }
        }
        else if (tokenEraOffset === 0) {
            // The user has presented a token from the current era.

            if (!eraCredentials.secret.equals(session.currentEraSecret)) {
                // Someone has presented a token from an alternate timeline.

                await this.doBestEffort('invalidate session (2)',
                        this.invalidateSession(
                            realmId, sessionId,
                            'presented token from alternate timeline'
                        ));

                throw errors.invalidCredentials({
                    prejudice: true,
                    reason: 'bad secret'
                });
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
        }
        else if (tokenEraOffset === 1) {
            // The user has presented a token from the next era.
            if (!crypto
                    .createHmac('sha256', session.nextEraAuthenticityKey)
                    .update(eraCredentials.secret).digest()
                    .equals(eraCredentials.signature)) {

                await this.doBestEffort('invalidate session (3)',
                        this.invalidateSession(realmId, sessionId,
                                'presented token from alternate timeline'));

                throw errors.invalidCredentials({
                    prejudice: true,
                    reason: 'bad secret'
                });
            }

            session = await advanceEra(this, session, session.currentEraSecret,
                    eraCredentials.secret);
        }
        else {
            // The token is from the far future? Really we need to blow up the
            // entire world, but for a start we can destroy this session.
            await this.doBestEffort('invalidate session (4)',
                    this.invalidateSession(realmId, sessionId,
                            'presented far future token'));

            throw errors.invalidCredentials({
                prejudice: true,
                reason: 'far future token'
            });
        }

        await this.doBestEffort('update session lastUsedAt field',
                this.mongoCollection.updateOne({
                    _id: sessionId,
                    lastUsedAt: { $lt: now }
                }, {
                    $set: { lastUsedAt: now }
                }));

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

    try {
        await sessions.mongoCollection.updateOne(where, update);
    }
    catch (e) {
        if (e.code !== 'E11001') {
            throw errors.unexpectedError(e);
        }

        throw errors.invalidCredentials({
            reason: 'expired token',
            retry: true
        });
    }

    return fromMongoDoc({
        ...session.toMongoDoc(),
        ...update.$set
    });
}

async function findWithMatchingFingerprintOrInvalidate(
        sessions, realmId, sessionId, agentFingerprint) {
    const sessionData = await sessions.mongoCollection.findOne({
        _id: sessionId,
        realmId
    });

    if (!sessionData) {
        throw errors.invalidCredentials({ reason: 'expired' });
    }

    if (sessionData.agentFingerprint
            && agentFingerprint !== sessionData.agentFingerprint) {

        await sessions.doBestEffort('invalidate session (4)',
                sessions.invalidateSession(
                    realmId, sessionId,
                    'agent fingerprint changed'
                ));

        throw errors.invalidCredentials({
            reason: 'fingerprint changed',
            prejudice: true
        });
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
