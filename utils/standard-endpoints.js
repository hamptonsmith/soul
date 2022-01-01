'use strict';

const bodyParser = require('koa-bodyparser');
const errors = require('../standard-errors');
const lodash = require('lodash');
const validate = require('./soul-validate');

module.exports = async (router, spec) => {
    for (const [endpoint, details] of Object.entries(spec)) {
        const [method, path] = endpoint.split(' ');

        const preMiddleware = [];

        try {
            await validate({ body: undefined },
                    (details.validator || (() => {})),
                    { validationWhitelist: ['/body'] });
        }
        catch (e) {
            if (e.code !== 'VALIDATION_ERROR') {
                throw errors.unexpectedError(e);
            }

            // We're expecting a body.
            preMiddleware.push(bodyParser(details.bodyparser || {}));
        }

        router[method.toLowerCase()](path, ...preMiddleware,
                async (ctx, next) => {
                    await validate({
                        body: ctx.request.body,
                        params: ctx.params,
                        query: ctx.query
                    }, details.validator || (() => {}));

                    await next();
                },
                details.handler);
    }
};
