'use strict';

const bs58 = require('bs58');
const yup = require('yup');

module.exports = class PageableCollectionOrder {
    constructor(id, collection, fields, filters = {}) {
        this.id = id;
        this.collection = collection;
        this.fields = [ ...fields, ['_id', 1] ];
        this.filters = filters;
        this.mongoSort = this.fields.reduce(
                (accum, [fieldName, direction]) => {
                    accum[fieldName] = direction;

                    return accum;
                }, {});
    }

    async find(filters = {}, after, limit = 50) {
        yup.string().nullable().validateSync(after);
        yup.number().min(1).max(100).validateSync(limit);

        const query = {};
        for (const [key, value] of Object.entries(filters)) {
            if (!this.filters[key]) {
                throw new Error('No such filter: ' + key);
            }

            this.filters[key](query, value);
        }

        if (after) {
            query = {
                $and: [
                    this.generateAfterQuery(this.decodeAfter(after)),
                    query
                ]
            }
        }

        const docs = await this.collection.find(query)
                .sort(this.mongoSort).limit(limit + 1).toArray();

        const result = {
            docs: docs.slice(0, Math.min(limit, docs.length))
        };

        if (docs.length > limit) {
            const lastDoc = result.docs[result.docs.length - 1];
            result.after =
                    bs58.encode(
                        Buffer.from(
                            JSON.stringify(
                                this.fields
                                .map(([fieldName]) => lastDoc[fieldName])
                                .map(el => el instanceof Date
                                    ? ({ $date: el.toISOString() })
                                    : el)),
                            'utf8'));
        }

        result.docs.forEach(d => {
            d.id = d._id;
            delete d._id;
        });

        return result;
    }

    decodeAfter(after) {
        let result;

        if (after) {
            result = JSON.parse(bs58.decode(after).toString('utf8'))
                    .map(el => el.$date ? new Date(el.$date) : el);

            if (!Array.isArray(result)) {
                throw new Error();
            }

            if (result.length !== this.fields.length) {
                throw new Error();
            }
        }

        return result;
    }

    generateAfterQuery(afterFieldValues) {
        let result;
        for (let i = afterFieldValues.length - 1; i >= 0; i--) {
            const [fieldName, sortDirection] = this.fields[i];
            const cursorValue = afterFieldValues[i];

            const next = compareQuery(fieldName, sortDirection, cursorValue);

            if (result) {
                result = {
                    $or: [
                        {
                            $and: [
                                { [fieldName]: { $eq: cursorValue }},
                                result
                            ]
                        },
                        next
                    ]
                };
            }
            else {
                result = next;
            }
        }

        return result;
    }
}

function compareQuery(name, dir, value) {
    return { [name]: { [`$${dir > 1 ? 'l' : 'g'}t`]: value } };
}
