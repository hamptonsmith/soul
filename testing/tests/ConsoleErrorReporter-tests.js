'use strict';

const ConsoleErrorReporter = require('../../utils/ConsoleErrorReporter')
const hermeticTest = require('../hermetic-test');
const test = require('ava');

test('reporter tests', hermeticTest((t, { log }) => {
    const reporter = new ConsoleErrorReporter(log);

    reporter.critical('critical message', new Error('critical error'));
    reporter.error('error message', { also: 'error details' });

    reporter.warning('warning message', new Error('warning error'), {
        also: 'warning details'
    });

    const warnError = new Error('warn error');
    const warnErrorCause = new Error('warn cause');
    warnError.cause = warnErrorCause;

    reporter.warn('warn message', warnError);

    reporter.debug(new Error('debug error'), { also: 'debug details' });
    reporter.info('info message');

    t.is(log.grep('critical message').length, 1);
    t.is(log.grep('critical error').length, 1);

    t.is(log.grep('error message').length, 1);
    t.is(log.grep('error details').length, 1);

    t.is(log.grep('warning message').length, 1);
    t.is(log.grep('warning error').length, 1);
    t.is(log.grep('warning details').length, 1);

    t.is(log.grep('warn message').length, 1);
    t.is(log.grep('warn error').length, 1);
    t.is(log.grep('warn cause').length, 1);

    t.is(log.grep('debug error').length, 1);
    t.is(log.grep('debug details').length, 1);

    t.is(log.grep('info message').length, 1);
}));
