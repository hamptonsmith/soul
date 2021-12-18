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

    const { data: sessionQuery } = await soul.get(`/realms/${realmId}`
            + `/sessions?accessToken=${sessionData.accessToken}`);

    t.is(sessionQuery.resources.length, 1);
    t.is(sessionQuery.resources[0].userId, 'usr_testuser');
}));
