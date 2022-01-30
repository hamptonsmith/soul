'use strict';

module.exports = {
    defaultRealmSecurityContexts: {
        anonymous: {},
        authenticated: {
            precondition: 'claims.sub and claims.iat >= $sessionRequestedAt - $ms("5m")',
            sessionOptions: {
                inactivityExpirationDuration: '90d'
            }
        },
        secure: {
            precondition: 'claims.sub and claims.iat >= $sessionRequestedAt - $ms("5m")',
            sessionOptions: {
                inactivityExpirationDuration: '30m',
                absoluteExpirationDuration: '6h'
            }
        }
    },
    defaultSessionEraGracePeriodDuration: '30s',
    defaultSessionGoverningPeriodLength: '5m'
};
