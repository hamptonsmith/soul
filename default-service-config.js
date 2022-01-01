'use strict';

module.exports = {
    defaultRealmSecurityContexts: {
        anonymous: {},
        authenticated: {
            precondition: 'claim.sub and claim.iat >= $now - $ms("5m")',
            sessionOptions: {
                inactivityExpirationDuration: '90d'
            }
        },
        secure: {
            precondition: 'claim.sub and claim.iat >= $now - $ms("5m")',
            sessionOptions: {
                inactivityExpirationDuration: '30m',
                absoluteExpirationDuration: '6h'
            }
        }
    },
    defaultSessionEraGracePeriodDuration: '30s',
    defaultSessionGoverningPeriodLength: '5m'
};
