'use strict';

module.exports = () => {
    let timers = [];

    const result = (ms, fn) => {
        timers.push({ ms, fn });
    };

    result.step = async amt => {
        const oldTimers = timers;
        timers = [];

        for (const t of oldTimers) {
            await t.fn();
        }
    };

    return result;
};
