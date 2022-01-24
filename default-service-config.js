'use strict';

module.exports = {
    defaultRealmSecurityContexts: {
        anonymous: {
            assertions: {
                any: 'true'
            }
        },
        authenticated: {
            assertions: {
                claimEquals: '$lookup(claim, arg.claimId) = arg.expected',
                claimEqualsCaseInsensitive:
                        '$lowercase($lookup(claim, arg.claimId)) '
                        + '= $lowercase(arg.expected)'
            },
            precondition: 'claim.sub and claim.iat >= $now - $ms("5m")',
            sessionOptions: {
                inactivityExpirationDuration: '90d'
            }
        },
        secure: {
            assertions: {
                claimEquals: '$lookup(claim, arg.claimId) = arg.expected',
                claimEqualsCaseInsensitive:
                        '$lowercase($lookup(claim, arg.claimId)) '
                        + '= $lowercase(arg.expected)'
            },
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
