import { describe, expect, it } from 'vitest'
import {
    createLogger,
    parseLogLevel,
    type LogRecord,
} from '../../src/core/logging/logger.js'

describe('logger', () => {
    it('filters records below the configured level', () => {
        const records: LogRecord[] = []
        const logger = createLogger({
            level: 'warn',
            scope: 'test',
            sink: (record) => {
                records.push(record)
            },
        })

        logger.debug('debug')
        logger.info('info')
        logger.warn('warn')
        logger.error('error')

        expect(records.map((record) => record.level)).toEqual(['warn', 'error'])
    })

    it('creates child scopes', () => {
        const records: LogRecord[] = []
        const logger = createLogger({
            level: 'debug',
            scope: 'app',
            sink: (record) => {
                records.push(record)
            },
        })

        logger.child('router').info('dispatching')

        expect(records).toHaveLength(1)
        expect(records[0]?.scope).toBe('app:router')
        expect(records[0]?.message).toBe('dispatching')
    })

    it('preserves arguments', () => {
        const records: LogRecord[] = []
        const logger = createLogger({
            level: 'debug',
            scope: 'test',
            sink: (record) => {
                records.push(record)
            },
        })

        const error = new Error('boom')
        logger.error('failed', error, 42)

        expect(records[0]?.args).toEqual([error, 42])
    })

    it('parses valid log levels', () => {
        expect(parseLogLevel('debug')).toBe('debug')
        expect(parseLogLevel('INFO')).toBe('info')
        expect(parseLogLevel(undefined)).toBe('info')
        expect(parseLogLevel('', 'warn')).toBe('warn')
    })

    it('rejects invalid log levels', () => {
        expect(() => parseLogLevel('verbose')).toThrow(/invalid log level/)
    })
})
