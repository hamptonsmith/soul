'use strict';

const clone = require('clone');
const errors = require('../standard-errors');
const deepequal = require('deepequal');
const EventEmitter = require('events');

class OptimisticDocument extends EventEmitter {
    constructor(collection, documentId, documentContainer, runtimeDeps) {
        super();

        this.collection = collection;
        this.documentId = documentId;
        this.documentContainer = documentContainer;
        this.runtimeDeps = runtimeDeps;

        this.documentContainer.on('documentChanged', d => {
            this.emit('documentChanged', d);
        });
    }

    close() {
        this.closed = true;
    }

    getData() {
        return this.documentContainer.getData().data;
    }

    async update(updateFn, onConflictFn = defaultOnConflictFn) {

        let retry = true;
        let lastError;
        let tries = 0;

        while (retry && !this.closed) {
            const currentVersion =
                    (await this.collection.findOne({ _id: this.documentId }))
                    || this.documentContainer.getData();

            if (currentVersion.version
                    !== this.documentContainer.getData().version) {
                this.documentContainer.setData(currentVersion);
            }

            const oldData = clone(currentVersion.data);
            let nextData = clone(currentVersion.data);

            nextData = await updateFn(nextData) || nextData;

            if (!deepequal(oldData, nextData) && !this.closed) {
                try {
                    await this.collection.replaceOne(
                            {
                                _id: this.documentId,
                                version: currentVersion.version
                            },
                            {
                                data: nextData,
                                version: currentVersion.version + 1
                            },
                            { upsert: true });

                    this.documentContainer.setData({
                        _id: this.documentId,
                        version: currentVersion.version + 1,
                        data: nextData
                    });

                    retry = false;
                    lastError = null;
                }
                catch (e) {
                    if (e.code !== 11000) {
                        throw errors.unexpectedError(e);
                    }

                    lastError = e;
                    tries++;
                    retry = await onConflictFn(
                            currentVersion.data, tries, this.runtimeDeps);
                }
            }
        }

        if (lastError) {
            throw errors.unexpectedError(lastError);
        }
    }
};

async function defaultOnConflictFn(data, tries, { schedule }) {
    if (tries < 3) {
        await new Promise((resolve, reject) => schedule(2500, resolve));
        return true;
    }

    return false;
}

module.exports = async (collection, documentId,
        { basePollMs = 15000, pollWindowMs = 30000 },
        runtimeDeps) => {
    const localDoc = new class extends EventEmitter {
        data = {
            _id: documentId,
            version: 0,
            data: {}
        };

        getData() {
            return this.data;
        }

        setData(d) {
            this.data = d;
            this.emit('documentChanged', this.data.data);
        }
    };

    const doc = new OptimisticDocument(
            collection, documentId, localDoc, runtimeDeps);

    function pollInterval() {
        return Math.floor(Math.random() * pollWindowMs) + basePollMs;
    }

    // Mongo has change streams, but they are mysteriously unavailable without a
    // replica set, so we default to polling. In the future, it'd be good to try
    // watching for changes first and then only fall back to polling when
    // necessary.
    async function pollValue() {
        if (!doc.closed) {
            try {
                const currentVersion =
                        (await collection.findOne({
                            _id: documentId
                        }))
                        || localDoc.getData();

                if (currentVersion.version !== localDoc.getData().version) {
                    localDoc.setData(currentVersion);
                }
            }
            catch (e) {
                runtimeDeps.errorReporter.warning(e);
            }

            runtimeDeps.schedule(pollInterval(), pollValue);
        }
    }

    await pollValue();

    return doc;
};
