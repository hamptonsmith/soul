'use strict';

const hermeticTest = require('../hermetic-test');
const test = require('ava');

test('health endpoint works', hermeticTest(async (t, { soul }) => {
    t.deepEqual(
        (await soul.get('/health')).data,
        {
            status: 'ok'
        }
    );
}));
