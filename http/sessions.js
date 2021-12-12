'use strict';

const bodyParser = require('koa-bodyparser');
const SbError = require('@shieldsbetter/sberror2')
const Joi = require('joi');

class UnknownMechanism extends SbError {
    static messageTemplate = 'Unknown POST /session mechanism: {{{got}}}. '
            + 'Should be "dev".';
}

module.exports = router => {
    router.get('/realms/:realmId/sessions', async (ctx, next) => {
        const { after, docs } = await ctx.services.realms.byCreationTime.find(
                { realmId: ctx.params.realmId },
                ctx.query.after,
                ctx.query.limit !== undefined
                        ? Number.parseInt(ctx.query.limit)
                        : undefined);

        ctx.status = 200;
        ctx.body = {
            continueToken: after,
            continueLink: after ? `${ctx.state.config.publicBaseHref}`
                    + `/realms/${ctx.params.realmId}/sessions`
                    + `?after=${after}&limit=${docs.length}` : undefined,
            resources: docs.map(d => ({
                href: `${ctx.state.config.publicBaseHref}`
                        + `/realms/${ctx.params.realmId}`
                        + `/sessions/${d.id}`,

                ...d
            }))
        };
    });

    router.post('/realms/:realmId/sessions', bodyParser(), async (ctx, next) => {
        switch (ctx.request.body.mechanism) {
            case 'dev': {
                Joi.assert({
                    body: ctx.request.body
                }, Joi.object({
                    body: {
                        agentFingerprint:
                                Joi.string().required().min(1).max(500),
                        existingUserOk: Joi.boolean(),
                        newUserOk: Joi.boolean(),
                        userId: Joi.string().required().pattern(
                                /^usr_[a-zA-Z0-9]{1,100}$/),
                    }
                }).strict());

                ctx.status = 201;
                ctx.body = await ctx.services.sessions.create(
                    ctx.params.realmId,
                    ctx.request.body.agentFingerprint,
                    ctx.request.body.userId
                );

                break;
            }
            default: {
                throw new UnknownMechanism({
                    got: ctx.request.body.mechanism
                });
            }
        }
    });
};
