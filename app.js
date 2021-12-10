'use strict';

const argon2 = require('argon2');
const bodyParser = require('koa-bodyparser');
const Bottle = require('bottlejs');
const crypto = require('crypto');
const Koa = require('koa');
const Router = require('@koa/router');
const SbError = require('@shieldsbetter/sberror2');
const SessionsService = require('./services/sessions');
const slurpUri = require('@shieldsbetter/slurp-uri');

const { MongoClient } = require('mongodb');

class InvalidArgument extends SbError {
    static messageTemplate = 'Argument "{{name}}" is invalid: {{reason}}';
}

class InvalidBodyField extends SbError {
    static messageTemplate = 'Body field {{fieldPath}} value '
            + '{{fieldValue}} is invalid: {{reason}}';
}

class IncorrectPassword extends SbError {
    static messageTemplate = 'Incorrect password.';
}

class MissingEnvironmentVariable extends SbError {
    static messageTemplate = 'Required environment variable not set: {{name}}';
}

class NoSuchResource extends SbError {
    static messageTemplate =
            'No such resource of type "{{type}}": {{description}}';
}

class AmbiguousResource extends SbError {
    static messageTemplate =
            'Multiple resources of type "{{type}}" meeting criteria: '
            + '{{description}}';
}

module.exports = async ({
    configUri = process.env.CONFIG_URI
} = {}) => {

    if (!configUri) {
        throw new MissingEnvironmentVariable({
            name: 'CONFIG_URI'
        });
    }

    const mongoClient = await MongoClient.connect(config.mongodb.uri);
    const dbClient = mongoClient.db(config.mongodb.dbName);
    const sessions = new SessionsService(dbClient);

    const services = {
        dbClient,
        sessions
    };

    const app = new Koa();
    const router = new Router();

    app.use(async (ctx, next) => {
        ctx.services = services;

        await next();
    });

    router.get('/realms', async (ctx, next) => {
        
    });

    router.post('/realm', bodyParser(), async (ctx, next) => {

    });

    router.post('/realm/:realmId/session', bodyParser(), async (ctx, next) => {
        switch (ctx.request.body.mechanism) {
            case 'dev': {



                break;
            }
            case 'userSpecifierAndPassword': {

                const userId = generateId('usr');
                await dbClient.collection('Users').insertOne({
                    _id: userId,
                    username: ctx.request.body.username,
                    email: ctx.request.body.email
                });

                break;
            }
        }
    });

    app
        .use(router.routes())
        .use(router.allowedMethods());

    app.listen(8080);
};

function expectError(e, matcher, action) {
    for (const [key, value] of Object.entries(matcher)) {
        if (e[key] !== value) {
            throw new UnexpectedError(e);
        }
    }

    action();
}

function doUserSpecifierAndPasswordSessionCreation(ctx) {
    if (ctx.request.body.existingOk) {
        let userId, passwordHash;
        try {
            ({ _id: userId, passwordHash } = await getUserBySpecifiers(
                    ctx.state.services, ctx.params.realmId,
                    ctx.request.body.assertedUserProperties,
                    { _id: 1, passwordHash: 1 }));
        }
        catch (e) {
            expectError(e, {
                invalidArgument: true,
                name: 'userSpecifiers',
                subcode: 'NO_PROVIDED_USER_SPECIFIERS'
            }, () => {

                throw new InvalidBodyField({
                    fieldPath: 'assertedUserProperties',
                    fieldValue: ctx.request.body.assertedUserProperties,
                    reason: `userSpecifiers must contain at least one of `
                            + `realm ${ctx.params.realmId}'s user specifiers: `
                            + e.acceptableSpecifiers
                });

            });
        }

        if (await argon2.verify(passwordHash, ctx.request.body.password)) {

        }
        else {
            throw new IncorrectPassword();
        }
    }

    if (ctx.request.body.createOk) {

    }
}

async function createSession(services, options) {
    const sessionId = generateId('sid');

    const accessTokenKeyBuffer = crypto.randomBytes(32);
    const refreshTokenKeyBuffer = crypto.randomBytes(32);

    // Future generations will need to be generated from a seed, but the first
    // generation can just be a random number.
    const acceptedAccessTokenBuffer = crypto.randomBytes(32);
    const acceptedRefreshTokenBuffer = crypto.randomBytes(32);

    await services.dbClient.collection('Sessions').insert({
        _id: sessionId,
        acceptedAccessNonce: bs58.encode(acceptedAccessTokenBuffer),
        acceptedRefreshNonce: bs58.encode(acceptedRefreshTokenBuffer),
        creationTime: new Date(),
        nextGenAccessKey: bs58.encode(accessTokenKeyBuffer),
        nextGenRefreshKey: bs58.encode(refreshTokenKeyBuffer)
    });
}

async function encrypt(iv, key, data) {
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);

    const parts = [cipher.update(data)];
    parts.push(cipher.final());
    return Buffer.concat(parts);
}

async function hmacSign(message, key) {
    return crypto.createHmac('sha256', key).update(message).digest();
}

async function getUserBySpecifiers(services, realmId, realmConfig,
        userSpecifiers = {}, projection) {
    const realmConfig = await getRealmConfig(services, realmId);

    const userSpecifiers = Object.fromEntries(
            Object.entries(userSpecifiers)
            .filter(([key]) => realmConfig.userSpecifierSet.includes(key)));

    if (Object.keys(userSpecifiers).length === 0) {
        throw new InvalidArgument({
            name: 'userSpecifiers',
            reason: `userSpecifiers must contain at least one of `
                    + `realm ${realmId}'s user specifiers: `
                    + realmConfig.userSpecifierSet,
            subcode: 'NO_PROVIDED_USER_SPECIFIERS',
            acceptableSpecifiers: realmConfig.userSpecifierSet
        });
    }

    const matches = await ctx.state.services.dbClient.collection('Users')
            .find(
                { properties: userSpecifiers },
                {
                    limit: 2,
                    projection
                })
            .toArray();

    if (matches.length > 1) {
        // This is possible since a realm's user specifiers can get
        // reconfigured over time.
        throw new AmbiguousResource({
            type: 'User',
            description: JSON.stringify(userSpecifiers)
        });
    }

    if (matches.length === 0) {
        throw new NoSuchResource({
            type: 'User',
            description: JSON.stringify(userSpecifiers)
        });
    }

    return matches[0];
}

async function getRealmConfig(services, realmId) {
    const realmConfig = await services.dbClient
            .collection('Realms').findOne({ _id: realmId });

    if (!realmConfig) {
        throw new NoSuchResource({
            type: 'Realm',
            description: `id ${realmId}`,
            id: realmId
        });
    }

    return realmConfig;
}

if (require.main === module) {
    module.exports().catch(e => {
        console.log(e);
        process.exit(1);
    })
}
