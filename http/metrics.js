'use strict';

module.exports = {
    'GET /metrics': {
        handler: async (ctx, next) => {
            ctx.status = 200;
            ctx.body = ctx.state.services.metrics.values;
        }
    }
};
