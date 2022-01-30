'use strict';

const assert = require('assert');
const bs58 = require('bs58');
const crypto = require('crypto');
const deepequal = require('deepequal');
const errors = require('../standard-errors');
const generateId = require('../utils/generate-id');
const lodash = require('lodash');
const ms = require('ms');
const PageableCollectionOrder = require('../utils/PageableCollectionOrder');
const RealmsService = require('./realms');
const SbError = require('@shieldsbetter/sberror2');
const tokensLib = require('../utils/tokens');
const validate = require('../utils/soul-validate');

const { DateTime } = require('luxon');

module.exports = class SessionsService {
    static idPrefix = 'sid';

    constructor(dbClient, jsonataService, leylineSettingsService, realmsService,
            { doBestEffort, errorReporter, nower }) {

        this.doBestEffort = doBestEffort;
        this.errorReporter = errorReporter;
        this.mongoCollection = dbClient.collection('Sessions');
        this.nower = nower;
        this.jsonata = jsonataService;
        this.leylineSettings = leylineSettingsService;
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
            /* nullable */ agentFingerprint) {
        await validate({
            realmId,
            securityContextName,
            idTokenClaims,
            agentFingerprint
        }, check => ({
            realmId: check.soulId(RealmsService.idPrefix),
            securityContextName: check.securityContextName(),
            idTokenClaims: (check, actual) => {
                if (JSON.stringify(idTokenClaims || null).length > 2000) {
                    throw new check.ValidationError('Id token\'s claims must '
                            + 'serialize to JSON shorter than 2000 characters, '
                            + 'but length was: '
                            + JSON.stringify(idTokens || null).length,
                            actual);
                }
            },
            agentFingerprint: check.optional(check.agentFingerprint())
        }));

        const realm = await this.realms.fetchById(realmId);

        const securityContextDefinition =
                lodash.get(realm, ['securityContexts', securityContextName]);

        if (!securityContextDefinition) {
            throw errors.noSuchSecurityContext(realmId, securityContextName);
        }

        const preconditionMemo = await claimsMeetPrecondition.call(this,
                securityContextDefinition, idTokenClaims);

        if (!preconditionMemo) {
            throw errors.invalidCredentials({
                reason: `claims failed precondition for security context
                        "${securityContextName}"`
            });
        }

        const governingPeriodLength = ms(
                realm.governingPeriodLength
                || this.leylineSettings.getConfig()
                    .defaultSessionGoverningPeriodLength);

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
            idTokenClaims: JSON.stringify(idTokenClaims),
            inactivityExpirationDuration: securityContextDefinition
                    .sessionOptions.inactivityExpirationDuration,
            lastUsedAt: now,
            preconditionMemo,
            realmId,
            securityContext: securityContextName
        };

        if (securityContextDefinition
                .sessionOptions.absoluteExpirationDuration) {
            session.expiresAt = new Date(now.valueOf()
                    + ms(securityContextDefinition
                            .sessionOptions.absoluteExpirationDuration));
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

    async recordLineActivityAndReturnSessions(realmId, desiredSecurityContext,
            tokens, /* nullable */ agentFingerprint) {
        await validate({
            realmId,
            desiredSecurityContext,
            tokens,
            agentFingerprint
        }, check => ({
            realmId: check.soulId(RealmsService.idPrefix),
            desiredSecurityContext: check.securityContextName(),
            tokens: check.array({ elements: check.string() }),
            agentFingerprint: check.optional(check.agentFingerprint())
        }));

        // Just the tokens signed by us, intended for this realm, and
        // intended for the requested security context.
        const credentialsBySessionId = tokensLib.decodeValid(realmId,
                desiredSecurityContext, tokens,
                this.leylineSettings.getConfig());

        const result = {
            addTokens: [],
            retireTokens: [],
            sessions: [],
            suspiciousSessionIds: [],
            suspiciousTokens: []
        };

        const realm = await this.realms.fetchById(realmId);

        const securityContextDefinition =
                lodash.get(realm, ['securityContexts', desiredSecurityContext]);

        if (!securityContextDefinition) {
            throw errors.noSuchSecurityContext(realmId, desiredSecurityContext);
        }

        // Get the data corresponding to the indicated sessions.
        const credentialSessions = (await this.mongoCollection.find({
            _id: { $in: Object.keys(credentialsBySessionId) }
        }).toArray()).map(fromMongoDoc);

        const bestEffortUpdates = [];

        let notYetInvalidatedSessions = credentialSessions;
        for (const filter of [
            s => {
                if (s.invalidated) {
                    throw new InvalidCredentials({
                        reason: 'session marked invalidated: ' +
                                s.invalidatedReason
                    });
                }
            },
            s => findWithMatchingFingerprintOrInvalidate.call(this,
                    realmId, s, agentFingerprint),
            s => stillMeetsPrecondition.call(this, s, realm,
                    securityContextDefinition, bestEffortUpdates),
            s => validateSessionCredentials.call(this, realmId,
                    desiredSecurityContext, s,
                    credentialsBySessionId[s.id].tokens)
        ]) {
            const filterResults = await Promise.allSettled(
                    notYetInvalidatedSessions.map(filter));

            let afterFilterSessions = [];
            for (let i = 0; i < notYetInvalidatedSessions.length; i++) {
                const session = notYetInvalidatedSessions[i];
                const errorReason = filterResults[i].reason;
                if (errorReason) {
                    if (errorReason.code !== 'INVALID_CREDENTIALS') {
                        throw errors.unexpectedError(errorReason);
                    }

                    for (const c
                            of credentialsBySessionId[session.id].tokens) {
                        result.retireTokens.push(c.originalToken);
                    }

                    if (errorReason.details.prejudice) {
                        for (const c
                                of credentialsBySessionId[session.id].tokens) {
                            result.suspiciousTokens.push(c.originalToken);
                        }

                        result.suspiciousSessionIds.push(session.id);
                    }
                }
                else {
                    afterFilterSessions.push(
                            filterResults[i].value || session);
                }
            }

            notYetInvalidatedSessions = afterFilterSessions;
        }

        if (bestEffortUpdates.length > 0) {
            const mongoUpdate =
                    this.mongoCollection.initializeUnorderedBulkOp();
            for (const { where, update } of bestEffortUpdates) {
                mongoUpdate.find(where).updateOne(update);
            }

            await this.doBestEffort(
                    'session data observations', mongoUpdate.execute());
        }

        // TODO: We've thrown away tokens and sessions that we aren't
        //       interested in, but that means we're potentially wasting an
        //       opportunity to detect malice. Rather than ignoring those
        //       we might have a separate best-effort malice-detection path so
        //       that we make fullest use of our available signal.

        for (const s of notYetInvalidatedSessions) {
            result.sessions.push(s.session);

            if (s.nextEraCredentials) {
                result.addTokens.push(
                        tokensLib.encode(realmId, s.session.id,
                                s.nextEraCredentials,
                                this.leylineSettings.getConfig()));
            }

            for (const c of s.retireCredentials) {
                result.retireTokens.push(c.originalToken);
            }
        }

        return result;
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

async function claimsMeetPrecondition(
        securityContextDefinition, idTokenClaims, previousResult) {

    let result;
    if (previousResult && previousResult.hash
            === securityContextDefinition.preconditionHash) {
        // Precondition hasn't changed. idTokenClaims and context -can't-
        // change. So our result is the same.
        result = previousResult;
    }
    else {
        const context = { sessionRequestedAt: this.nower() };

        try {
            if (!await this.jsonata.evaluate(
                    securityContextDefinition.precondition || 'true',
                    { claims: idTokenClaims }, context)) {
                result = false;
            }
            else {
                result = {
                    context,
                    hash: securityContextDefinition.preconditionHash
                };
            }
        }
        catch (e) {
            if (e.code !== 'JSONATA_COMPILATION_ERROR'
                    && e.code !== 'JSONATA_RUNTIME_ERROR') {
                throw errors.unexpectedError(e);
            }

            this.errorReporter.warning(e);

            // We treat this as a normal precondition failure.
            result = false;
        }
    }

    return result;
}

async function findWithMatchingFingerprintOrInvalidate(
        realmId, sessionData, agentFingerprint) {
    if (sessionData.agentFingerprint
            && agentFingerprint !== sessionData.agentFingerprint) {

        await this.doBestEffort('invalidate session (4)',
                this.invalidateSession(
                    realmId, sessionData.id,
                    'agent fingerprint changed'
                ));

        throw errors.invalidCredentials({
            reason: 'fingerprint changed',
            prejudice: true
        });
    }
}

function fromMongoDoc(d) {
    const result = { ...d, id: d._id };
    delete result._id;

    return result;
}

function setSubtract(a1, a2) {
    const a2Set = new Set(a2);

    const result = a1.filter(el => !a2Set.has(el));

    return result;
}

function sign(text, secret) {
    return crypto.createHmac('sha256', secret).update(text).digest();
}

async function stillMeetsPrecondition(
        session, realm, securityContextDefinition, bestEffortUpdatesAccum) {
    // Some sessions may have been established under an old version of this
    // security context, in which case the precondition needs to be
    // rechecked.

    const newPreconditionMemo = await claimsMeetPrecondition.call(this,
            realm, securityContextDefinition, session.idTokenClaims,
            session.preconditionMemo);

    if (newPreconditionMemo) {
        if (newPreconditionMemo !== session.preconditionMemo) {

            // Update the preconditionMemo so we won't keep
            // recalculating this. Note that if this update fails, it's
            // nbd. We'll just detect that the precondition needs to be
            // evaluated again next time and issue the update once
            // again.
            bestEffortUpdatesAccum.push({
                where: { _id: session.id },
                update: {
                    $set: { preconditionMemo: newPreconditionMemo }
                }
            });
        }
    }
    else {
        throw errors.invalidCredentials({
            reason: 'claims no longer meet precondition'
        });

        // Mark the session invalidated in the database.
        // Note that if this update fails, it's nbd. We're not passing
        // this session along to the client and we'll just detect the
        // issue again next time and try once again to invalidate.
        bestEffortUpdatesAccum.push({
            where: { _id: session.id },
            update: {
                $set: {
                    invalidated: true,
                    invalidatedReason: 'security context precondition '
                            + 'no longer held'
                }
            }
        });
    }
}

function toMongoDoc(o) {
    const result = { ...o, _id: o.id };
    delete result.id;

    return result;
}

async function validateSessionCredentials(
        realmId, expectedSecurityContext, session, credentials) {

    assert(!session.invalidated);
    assert(credentials.every(c => c.sessionId === session.id));
    assert(credentials.every(
            c => c.securityContext === expectedSecurityContext));

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

    const now = DateTime.fromJSDate(new Date(this.nower()));

    if (session.expiresAt && now > DateTime.fromJSDate(session.expiresAt)) {
        throw errors.invalidCredentials({
            reason: 'session expired',
            relog: true
        });
    }

    if (session.inactivityExpirationDuration) {
        const expirationPeriodMs = ms(session.inactivityExpirationDuration);

        const expiresAt = DateTime.fromJSDate(session.lastUsedAt)
                .plus(expirationPeriodMs);

        if (now > expiresAt) {
            throw errors.invalidCredentials({
                reason: 'session expired',
                relog: true
            });
        }
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
                || this.leylineSettings.getConfig()
                    .defaultSessionEraGracePeriodDuration);

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
        _id: session.id,
        lastUsedAt: { $lt: now }
    }, {
        $set: { lastUsedAt: now }
    });

    return {
        session,

        nextEraCredentials,
        retireCredentials: retiredCredentials
    };
}
