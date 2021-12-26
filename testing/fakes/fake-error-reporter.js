'use strict';

module.exports = class FakeErrorReporter {
    reports = {};

    constructor(log) {
        this.log = log;
    }

    critical(...args) {
        this.doLog('CRITICAL', ...args);
    }

    error(...args) {
        this.doLog('ERROR', ...args);
    }

    warning(...args) {
        this.doLog('WARNING', ...args);
    }

    warn(...args) {
        this.doLog('WARNING', ...args);
    }

    debug(...args) {
        this.doLog('DEBUG', ...args);
    }

    info(...args) {
        this.doLog('INFO', ...args);
    }

    doLog(severity, ...otherArgs) {
        let error;
        let details;
        let message;

        for (const arg of otherArgs) {
            if (arg instanceof Error) {
                error = arg;
            }
            else if (arg instanceof String) {
                message = arg;
            }
            else {
                details = arg;
            }
        }

        let output = `${severity}:`;

        if (message) {
            output += ' ' + message;
        }

        if (error) {
            if (message) {
                output += '\n\n';
            }

            output += error.stack;

            let cause = error.cause;
            while (cause) {
                output += '\n\nCaused by: ' + cause.stack;
                cause = cause.cause;
            }
        }

        if (details) {
            if (message || error) {
                output += '\n\nDetails: ';
            }

            output += JSON.stringify(details, null, 4);
        }

        for (const line of output.split('\n')) {
            this.log(line);
        }

        const lcSeverity = severity.toLowerCase();
        if (!this.reports[lcSeverity]) {
            this.reports[lcSeverity] = [];
        }

        this.reports[lcSeverity].push({ details, error, message });
    }
};
