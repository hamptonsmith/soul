'use strict';

const { MongoClient } = require('mongodb');

module.exports = () => {
    const interceptors = [];

    return {
        addInterceptor(test, action) {
            interceptors.push({ action, test });
        },
        MongoClient: {
            connect: async (uri, opts) => {
                const realClient = await MongoClient.connect(uri, opts);

                return {
                    db(dbName) {
                        return interceptableDbClient(
                                dbName, realClient.db(dbName), interceptors);
                    },
                    close: () => realClient.close()
                };
            }
        }
    };
};

function fnHandlers(dbName, colName, fnName, interceptors) {
    return {
        apply(target, thisArg, args) {
            const { action: interceptor } = interceptors.find(
                        i => i.test(dbName, colName, fnName, args))
                        || ({ action: () => {} });

            const iResult = interceptor(dbName, colName, fnName, args);

            let result;
            if (iResult && iResult.then) {
                result = iResult.then(() => target.apply(thisArg, args));
            }
            else {
                result = target.apply(thisArg, args);
            }

            return result;
        }
    };
}

function interceptableDbClient(dbName, realDbClient, interceptors) {
    return {
        collection(name) {
            return interceptableCollectionClient(
                dbName,
                name,
                realDbClient.collection(name),
                interceptors
            );
        }
    };
}

function interceptableCollectionClient(
        dbName, colName, realColClient, interceptors) {

    return new Proxy(realColClient, {
        get(target, fieldName, receiver) {
            let result = Reflect.get(...arguments);

            if (typeof result === 'function') {
                result = new Proxy(result,
                        fnHandlers(dbName, colName, fieldName, interceptors));
            }

            return result;
        }
    });
}
