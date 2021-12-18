'use strict';

const clone = require('clone');
const errors = require('../standard-errors');
const EventEmitter = require('events');
const deepequal = require('deepequal');

class OptimisticDocument extends EventEmitter {
    constructor(collection, documentId, documentContainer, runtimeDeps) {
        super();

        this.collection = collection;
        this.documentName = documentId;
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
            let nextData = await updateFn(currentVersion.data)
                    || currentVersion.data;

            if (!deepequal(nextData, oldData)) {
                nextData = currentVersion.data;
            }

            if (nextData !== undefined && !this.closed) {
                try {
                    await this.collection.replaceOne({
                        _id: this.documentId,
                        version: currentVersion.version
                    },
                    {
                        version: currentVersion.version + 1,
                        data: nextData
                    });

                    if (currentVersion.version
                            !== this.documentContainer.getData().version) {
                        this.documentContainer.setData({
                            _id: this.documentId,
                            version: currentVersion.version + 1,
                            data: nextData
                        });
                    }

                    retry = false;
                }
                catch (e) {
                    if (e.code !== 'E11000') {
                        throw errors.unexpectedError(e);
                    }

                    tries++;
                    retry = await onConflictFn(
                            currentVersion.data, tries, runtimeDeps);
                }
            }
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
            this.emit('documentChanged', this.data);
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
                        (await this.collection.findOne({
                            _id: this.documentId
                        }))
                        || this.documentContainer.getData();

                if (currentVersion.version !== localDoc.getData().version) {
                    localDoc.setData(currentVersion);
                }
            }
            catch (e) {
                if (e.code !== 'E11000') {
                    runtimeDeps.errorReporter.warning(e);
                }
            }

            runtimeDeps.schedule(pollInterval(), pollValue);
        }
    }

    runtimeDeps.schedule(pollInterval(), pollValue);

    return doc;
};
