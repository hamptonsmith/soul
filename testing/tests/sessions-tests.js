'use strict';

const hermeticTest = require('../hermetic-test');
const test = require('ava');

test('create dev session w/ new user', hermeticTest(
        async (t, { soul, nower }) => {

    const { data: { id: realmId }} = await soul.post('/realms');

    const { data: sessionData } = await soul.post(`/realms/${realmId}/sessions`, {
        mechanism: 'dev',
        metadata: {},
        newUserOk: true,
        userId: 'usr_testuser'
    });

    const { data: accessAttemptData } = await soul.post(`/realms/${realmId}`
            + `/accessAttempts`, { sessionToken: sessionData.sessionToken });

    t.is(accessAttemptData.resolution, 'valid');
    t.is(accessAttemptData.session.userId, 'usr_testuser');
}));
