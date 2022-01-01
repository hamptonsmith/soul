'use strict';

const crypto = require('crypto');
const errors = require('../standard-errors');
const generateId = require('../utils/generate-id');
const PageableCollectionOrder = require('../utils/PageableCollectionOrder');
const validate = require('../utils/soul-validate');

module.exports = class RealmsService {
    static idPrefix = 'rlm';

    constructor(dbClient, { nower }) {
        this.dbClient = dbClient;
        this.nower = nower;

        this.byCreationTime = new PageableCollectionOrder(
                'createdAt',
                this.dbClient.collection('Realms'),
                [['createdAt', 1]],
                fromMongoDoc);
    }

    async create(friendlyName, securityContexts = {}) {
        await validate({
            friendlyName,
            securityContexts
        }, check => ({
            friendlyName: check.string({ minLength: 0, maxLength: 100 }),
            securityContexts: check.object({}, {
                unknownEntries: {
                    key: check.string({ regexp: /^\w{1,50}$/ }),
                    value: {
                        precondition: check.optional(check.string({
                            minLength: 0,
                            maxLength: 1000
                        })),
                        sessionOptions: check.optional({
                            absoluteExpirationDuration: check.optional(
                                    check.friendlyDuration()),
                            inactivityExpirationDuration: check.optional(
                                    check.friendlyDuration())
                        })
                    }
                }
            })
        }));

        const now = new Date(this.nower());

        const id = generateId('rlm');

        const newDoc = {
            createdAt: now,
            friendlyName,
            securityContexts:
                Object.fromEntries(Object.entries(securityContexts)
                        .map(([
                            contextName,
                            {
                                precondition = 'true',
                                sessionOptions: {
                                    absoluteExpirationDuration,
                                    inactivityExpirationDuration
                                } = {}
                            }
                        ]) => ([
                            contextName,
                            {
                                precondition,
                                sessionOptions: {
                                    absoluteExpirationDuration,
                                    inactivityExpirationDuration
                                },
                                versionNumber: 0
                            }
                        ]))),
            updatedAt: now
        };

        await this.dbClient.collection('Realms')
                .insertOne({ _id: id, ... newDoc });

        return { id, ...newDoc };
    }

    async fetchById(id) {
        await validate(id, check => check.soulId(RealmsService.idPrefix));

        const result =
                await this.dbClient.collection('Realms').findOne({ _id: id });

        if (!result) {
            throw errors.noSuchRealm(id);
        }

        return fromMongoDoc(result);
    }
};

function fromMongoDoc(d) {
    return {
        createdAt: d.createdAt,
        friendlyName: d.friendlyName,
        id: d._id,
        securityContexts: d.securityContexts,
        updatedAt: d.updatedAt
    };
}
