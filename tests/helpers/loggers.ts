import {
    createLogger,
    type LogRecord,
    type Logger,
} from '../../src/core/logging/logger.js'

export interface CapturingLogger {
    logger: Logger
    records: LogRecord[]
}

export function createCapturingLogger(scope = 'test'): CapturingLogger {
    const records: LogRecord[] = []
    const logger = createLogger({
        level: 'debug',
        scope,
        sink: (record) => {
            records.push(record)
        },
    })

    return { logger, records }
}

export function createTestLogger(scope = 'test'): Logger {
    return createLogger({
        scope,
        sink: () => {},
    })
}
