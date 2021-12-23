'use strict';

const bodyParser = require('koa-bodyparser');
const validate = require('./validator');
const lodash = require('lodash');

module.exports = (router, spec) => {
    for (const [endpoint, details] of Object.entries(spec)) {
        const [method, path] = endpoint.split(' ');

        const preMiddleware = [];
        if (lodash.get(details, 'validator.body')) {
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
