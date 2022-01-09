'use strict';

const defaultServiceConfig = require('../default-service-config');

module.exports = class LeylineSettingsService {
    constructor(configDoc) {
        this.configDoc = configDoc;
    }

    getExplicitConfig() {
        return this.configDoc.getData();
    }

    getExplicitConfigVersionNumber() {
        return this.configDoc.getVersionNumber();
    }

    getConfig() {
        return {
            ...defaultServiceConfig,
            ...this.configDoc.getData()
        };
    }

    async updateExplicitConfig(updateFn, onConflictFn, expectedVersion) {
        await this.configDoc.update(updateFn, onConflictFn, expectedVersion);
    }
};
