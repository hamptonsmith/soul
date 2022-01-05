'use strict';

const bs58 = require('bs58');
const crypto = require('crypto');
const errors = require('../standard-errors');
const generateId = require('../utils/generate-id');
const ms = require('ms');
const PageableCollectionOrder = require('../utils/PageableCollectionOrder');
const RealmsService = require('./realms');
const SbError = require('@shieldsbetter/sberror2');
const validate = require('../utils/soul-validate');

const { DateTime } = require('luxon');

module.exports = class SessionsService {
    static idPrefix = 'sid';

    constructor(dbClient, jsonataService, realmsService,
            { doBestEffort, nower }) {

        this.doBestEffort = doBestEffort;
        this.mongoCollection = dbClient.collection('Sessions');
        this.nower = nower;
        this.jsonata = jsonataService;
        this.realms = realmsService;

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

    async create(realmId, securityContextName, /* nullable */ idTokenClaims,
            /* nullable */ agentFingerprint, /* nullable */ subjectId, config) {
        await validate({
            realmId,
            securityContextName,
            agentFingerprint,
            subjectId
        }, check => ({
            realmId: check.soulId(RealmsService.idPrefix),
            securityContextName: check.securityContextName(),
            agentFingerprint: check.optional(check.agentFingerprint()),
            subjectId: check.optional(
                    check.string({ minLength: 1, maxLength: 200 }))
        }));

        const realm = await this.realms.fetchById(realmId);

        const securityContextDefinition = await getSatisfiableSecurityContext(
                this, realm, securityContextName, idTokenClaims || {});

        const governingPeriodLength = ms(
                realm.governingPeriodLength
                || config.defaultSessionGoverningPeriodLength);

        const id = generateId(SessionsService.idPrefix);
        const now = new Date(this.nower());
        const tokenId = generateId('tkn');

        const session = {
            acceptedCurrentEraTokenIds: [tokenId],
            acceptedPreviousEraTokenIds: [],
            agentFingerprint,
            createdAt: now,
            currentEraStartedAt: now,
            currentEraNumber: 0,
            governingPeriodLength,
            id: id,
            idTokenClaims,
            inactivityExpirationDuration:
                    securityContextDefinition.inactivityExpirationDuration,
            lastUsedAt: now,
            realmId,
            securityContext: securityContextDefinition.id,
            subjectId
        };

        if (securityContextDefinition.absoluteExpirationDuration) {
            session.expiresAt = new Date(now.valueOf()
                    + securityContextDefinition.absoluteExpirationDuration);
        }

        await this.mongoCollection.insertOne(toMongoDoc(session));

        return {
            eraCredentials: {
                eraNumber: 0,
                securityContext: session.securityContext,
                tokenId: tokenId
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

    async validateSessionCredentials(realmId, expectedSecurityContext,
            sessionId, credentials, agentFingerprint, config) {
        await validate({
            realmId,
            expectedSecurityContext,
            sessionId,
            agentFingerprint
        }, check => ({
            realmId: check.soulId(RealmsService.idPrefix),
            expectedSecurityContext: check.versionedSecurityContextName(),
            sessionId: check.soulId(SessionsService.idPrefix),
            agentFingerprint: check.optional(check.agentFingerprint())
        }));

        if (credentials.every(
                c => c.securityContext !== expectedSecurityContext)) {
            throw errors.invalidCredentials({
                reason: 'incorrect security context. Wanted: '
                        + expectedSecurityContext
            });
        }

        const latestEraRepresented = credentials.reduce(
                (accum, { eraNumber }) => eraNumber > accum ? eraNumber : accum,
                0);

        const unretiredCredentials = [];
        const retiredCredentials = [];

        for (const c of credentials) {
            if (c.eraNumber === latestEraRepresented) {
                unretiredCredentials.push(c);
            }
            else {
                retiredCredentials.push(c);
            }
        }

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

        if (session.expiresAt && now > DateTime.fromJSDate(session.expiresAt)) {
            throw errors.invalidCredentials({
                reason: 'session expired',
                relog: true
            });
        }

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

        const mongoUpdate = {
            $push: {},
            $set: { lastUsedAt: now }
        };

        const tokenEraOffset = latestEraRepresented - session.currentEraNumber;
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

            const additionalTokenIds = setSubtract(
                    unretiredCredentials.map(({ tokenId }) => tokenId),
                    session.acceptedPreviousEraTokenIds);

            if (additionalTokenIds.length === unretiredCredentials.length) {
                // None of the provided tokens matched an existing token.
                // Danger!

                await this.doBestEffort('invalidate session (1)',
                        this.invalidateSession(
                            realmId, sessionId,
                            'presented token from alternate timeline'
                        ));

                throw errors.invalidCredentials({
                    prejudice: true,
                    reason: 'bad credentials'
                });
            }

            const gracePeriodMs = ms(
                    session.eraGracePeriodDuration
                    || config.defaultSessionEraGracePeriodDuration);

            const acceptableUntil =
                    DateTime.fromJSDate(session.currentEraStartedAt)
                    .plus(gracePeriodMs);

            if (now > acceptableUntil) {
                throw errors.invalidCredentials({
                    reason: 'token expired',
                    retry: true
                });
            }

            mongoUpdate.$push.acceptedPreviousEraTokenIds =
                    { $each: additionalTokenIds };
        }
        else if (tokenEraOffset === 0) {
            // The user has presented a token from the current era.

            const additionalTokenIds = setSubtract(
                    unretiredCredentials.map(({ tokenId }) => tokenId),
                    session.acceptedCurrentEraTokenIds);

            if (additionalTokenIds.length === unretiredCredentials.length) {
                // None of the provided tokens matched an existing token.
                // Danger!

                await this.doBestEffort('invalidate session (1)',
                        this.invalidateSession(
                            realmId, sessionId,
                            'presented token from alternate timeline'
                        ));

                throw errors.invalidCredentials({
                    prejudice: true,
                    reason: 'bad credentials'
                });
            }

            if (now >= DateTime.fromJSDate(
                    session.currentEraGoverningPeriodEndsAt)) {
                // These credentials are fine, but this era is in its lame duck
                // period, so let's suggest some next-era credentials.

                const nextEraTokenId = crypto.randomBytes(32);
                nextEraCredentials = {
                    index: session.currentEraNumber + 1,
                    securityContext: session.securityContext,
                    tokenId: nextEraTokenId
                };
            }

            mongoUpdate.$push.acceptedCurrentEraTokenIds =
                    { $each: additionalTokenIds };
        }
        else if (tokenEraOffset === 1) {
            // The user has presented a token from the next era.
            session = advanceEra(this, session,
                    session.acceptedCurrentEraTokenIds,
                    unretiredCredentials.map(({ tokenId }) => tokenId));
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

        await this.mongoCollection.updateOne({
            _id: sessionId,
            lastUsedAt: { $lt: now }
        }, {
            $set: { lastUsedAt: now }
        });

        return {
            ...session,

            nextEraCredentials,
            retireCredentials: retiredCredentials
        };
    }
};

async function advanceEra(
        sessions, session, currentAccepted, nextAccepted) {
    const where = {
        _id: { $eq: session.id },

        // Make sure somebody else hasn't accepted a refresh key and advanced
        // era in the mean time.
        currentEraNumber: { $eq: session.currentEraNumber }
    };

    const now = new Date(sessions.nower());
    const update = {
        $set: {
            acceptedCurrentEraTokenIds: nextAccepted,
            acceptedPreviousEraTokenIds: currentAccepted,
            currentEraStartedAt: now,
            currentEraNumber: currentEraNumber + 1,
            lastUsedAt: now
        }
    };

    try {
        await sessions.mongoCollection.updateOne(where, update);
    }
    catch (e) {
        if (e.code !== 11001) {
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
        absoluteExpirationDuration: d.absoluteExpirationDuration,
        acceptedCurrentEraTokenIds: d.acceptedCurrentEraTokenIds,
        acceptedPreviousEraTokenIds: d.acceptedPreviousEraTokenIds,
        agentFingerprint: d.agentFingerprint,
        createdAt: d.createAt,
        currentEraStartedAt: d.currentEraStartedAt,
        currentEraNumber: d.currentEraNumber,
        governingPeriodLength: d.governingPeriodLength,
        lastUsedAt: d.lastUsedAt,
        id: d._id,
        inactivityExpirationDuration: d.inactivityExpirationDuration,
        realmId: d.realmId,
        securityContext: d.securityContext,
        subjectId: d.subjectId
    };
}

async function getSatisfiableSecurityContext(
        sessions, realm, securityContext, idTokenClaims) {
    const specifiedContext = (realm.securityContexts || {})[securityContext];

    if (!specifiedContext) {
        throw errors.invalidCredentials({
            reason: `no such security context: ${securityContext}`
        });
    }

    if (!sessions.jsonata.evaluate(
            specifiedContext.precondition, { claims: idTokenClaims })) {
        throw errors.invalidCredentials({
            reason: `security context "${securityContext}" precondition not met`
        });
    }

    return {
        id: `${securityContext}:${specifiedContext.versionNumber}`,
        ...specifiedContext.sessionOptions
    };
}

function setSubtract(a1, a2) {
    const a2Set = new Set(a2);

    const result = a1.filter(el => !a2Set.has(el));

    return result;
}

function sign(text, secret) {
    return crypto.createHmac('sha256', secret).update(text).digest();
}

function toMongoDoc(o) {
    return {
        _id: o.id,
        absoluteExpirationDuration: o.absoluteExpirationDuration,
        acceptedCurrentEraTokenIds: o.acceptedCurrentEraTokenIds,
        acceptedPreviousEraTokenIds: o.acceptedPreviousEraTokenIds,
        agentFingerprint: o.agentFingerprint,
        createdAt: o.createAt,
        currentEraStartedAt: o.currentEraStartedAt,
        currentEraNumber: o.currentEraNumber,
        governingPeriodLength: o.governingPeriodLength,
        inactivityExpirationDuration: o.inactivityExpirationDuration,
        lastUsedAt: o.lastUsedAt,
        realmId: o.realmId,
        securityContext: o.securityContext,
        subjectId: o.subjectId
    };
}
