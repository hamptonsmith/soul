'use strict';

const crypto = require('crypto');
const errors = require('../standard-errors');
const generateId = require('../utils/generate-id');
const Joi = require('joi');
const PageableCollectionOrder = require('../utils/PageableCollectionOrder');
const SbError = require('@shieldsbetter/sberror2');

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
        Joi.assert({
            realmId,
            metadata
        }, Joi.object({
            realmId: Joi.string().required().min(1).max(100),
            metadata: metadataValidation()
        }).strict());

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
        Joi.assert(realmId, Joi.string().min(1).max(100).required());
        Joi.assert(userId, Joi.string().min(1).max(100).required());

        return fromMongoDoc(
                this.mongoCollection.findOne({ _id: userId, realmId }));
    }

    async fuzzyFind(realmId, /* nullable */ userId, metadata = {}) {
        Joi.assert({
            realmId,
            userId,
            metadata
        }, Joi.object({
            realmId: Joi.string().require().min(1).max(100),
            userId: Joi.string().optional().min(1).max(100),
            metadata: metadataValidation()

                // Additionally, no arrays...
                .pattern(/^.*$/, [
                    Joi.boolean(),
                    Joi.number(),
                    Joi.string()
                ])
        }).strict());

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

function metadataValidation() {
    return Joi.object()
            .pattern(/^.*$/, [
                Joi.boolean(),
                Joi.number(),
                Joi.string(),
                Joi.array().items(Joi.alternatives().try(
                    Joi.boolean(),
                    Joi.number(),
                    Joi.string()
                )).strict()
            ])
            .custom(v => {
                if (JSON.stringify(v).length > 5000) {
                    throw new Error('Metadata must serialize to JSON '
                            + 'at most 5000 utf8 codepoints in '
                            + 'length.  Got: ' + JSON.stringify(v));
                }

                return v;
            });
}
