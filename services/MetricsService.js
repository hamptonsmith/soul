'use strict';

module.exports = class MetricsService {
    values = {};

    increment(key, delta) {
        if (!this.values[key]) {
            this.values[key] = 0;
        }

        this.values[key] += delta;
    }
};
