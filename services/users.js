'use strict';

const crypto = require('crypto');
const errors = require('../standard-errors');
const generateId = require('../utils/generate-id');
const PageableCollectionOrder = require('../utils/PageableCollectionOrder');
const SbError = require('@shieldsbetter/sberror2');
const validate = require('../utils/validator');

module.exports = class UsersService {
    constructor(dbClient, realms, { nower }) {
        this.mongoCollection = dbClient.collection('Users');
        this.nower = nower;
        this.realms = realms;

        this.byCreationTime = new PageableCollectionOrder(
                'createdAt',
                this.mongoCollection,
                [['createdAt', 1]],
                d => {
                    d.id = d._id;
                    delete d._id;
                    return d;
                },
                {
                    realmId: (query, value) => {
                        query.realmId = { $eq: value };
                    }
                });
    }

    async create(realmId, metadata = {}, { id = generateId('usr') } = {}) {
        validate({ realmId, metadata, id }, check => ({
            realmId: check.string({ minLength: 1, maxLength: 100 }),
            metadata: metadataValidation(check)
        }));

        const realm = this.realms.fetchById(realmId);

        // There's a race condition here--the realm's user specifiers could be
        // updated out from under us whle we build this query, but that's fine.
        // We already allow for these specifiers to change in such a way that
        // existing users collide, so we'll handle that error case robustly
        // elsewhere. The other case, that we reject a user that is now
        // acceptible, is a tolerable corner case--we rejected according to a
        // consistent view of the database at some point in time. The client
        // will theoretically try again and succeed.
        const userSpecifierGuard = {};
        const emptyRefrenceObject = {};
        for (const specifier of (realm.userSpecifierSet || [])) {
            if (!emptyReferenceObject[specifier] && metadata[specifier]) {
                userSpecifierGuard[`metadata.${specifier}`] = {
                    $neq: metadata[specifier]
                };
            }
        }

        if (!id) {
            id = generateId('usr');
        }

        const now = new Date(this.nower());
        const doc = {
            $set: {
                _id: id,
                createdAt: now,
                metadata,
                metadataGeneration: 0,
                realmId,
                updatedAt: now
            }
        };

        const { upsertedCount } = await this.mongoCollection
                .updateOne(
                        { _id: id, ...userSpecifierGuard },
                        doc,
                        { upsert: true });

        if (upsertedCount < 1) {
            throw errors.duplicateUser();
        }

        return id;
    }

    async fetchById(realmId, userId) {
        validate({ realmId, userId }, check => ({
            realmId: check.string({ minLength: 1, maxLength: 100 }),
            userId: check.string({ minLength: 1, maxLength: 100 })
        }));

        return fromMongoDoc(
                this.mongoCollection.findOne({ _id: userId, realmId }));
    }

    async fuzzyFind(realmId, /* nullable */ userId, metadata = {}) {
        validate({ realmId, userId, metadata }, check => ({
            realmId: check.string({ minLength: 1, maxLength: 100 }),
            userId: check.string({ minLength: 1, maxLength: 100 }),
            metadata: [
                ...metadataValidation(check),

                // And also, no arrays...
                check.union(check.boolean(), check.number(), check.string())
            ]
        }));

        const search = {};

        if (userId) {
            search._id = userId;
        }

        const emptyReferenceObject = {};
        for (const [key, value] of Object.entries(metadata)) {
            if (!emptyReferenceObject[key]) {
                search[`metadata.${key}`] = value;
            }
        }

        return (await this.mongoCollection.findAll(search).toArray())
                .map(d => fromMongoDoc(d));
    }
};

function fromMongoDoc(d) {
    if (!d) {
        return d;
    }

    return {
        createdAt: d.createdAt,
        id: d._id,
        metadata: d.metadata,
        metadataGeneration: d.metadataGeneration,
        realmId: d.realmId,
        updatedAt: d.updatedAt
    }
}

function metadataValidation(check) {
    return [
        (check, metadata) => {
            if (JSON.stringify(metadata).length > 5000) {
                throw new check.ValidationError('Metadata must '
                        + 'serialize to JSON at most 5000 utf8 '
                        + 'codepoints in length.');
            }
        },
        check.object({}, {
            unknownEntries: {
                key: check.string({ regexp: /^\w{0,50}$/ }),
                value: check.union(
                    check.boolean(),
                    check.string(),
                    check.number(),
                    check.array({
                        elements: check.union(
                            check.boolean(),
                            check.string(),
                            check.number()
                        )
                    })
                )
            }
        })
    ];
}
