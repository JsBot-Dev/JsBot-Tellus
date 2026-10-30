export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export const logLevels = ['debug', 'info', 'warn', 'error'] as const

const LEVEL_WEIGHT: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
}

export interface LogRecord {
    level: LogLevel
    scope: string
    message: string
    args: unknown[]
    time: Date
}

export type LogSink = (record: LogRecord) => void

export interface LoggerOptions {
    level?: LogLevel | undefined
    scope?: string | undefined
    sink?: LogSink | undefined
}

export interface Logger {
    readonly level: LogLevel
    debug(message: string, ...args: unknown[]): void
    info(message: string, ...args: unknown[]): void
    warn(message: string, ...args: unknown[]): void
    error(message: string, ...args: unknown[]): void
    child(scope: string): Logger
}

export function formatValue(value: unknown): string {
    if (value instanceof Error) {
        return value.stack ?? `${value.name}: ${value.message}`
    }

    if (typeof value === 'string') return value
    if (typeof value === 'bigint') return value.toString()

    try {
        return JSON.stringify(value) ?? String(value)
    } catch {
        return String(value)
    }
}

export const defaultLogSink: LogSink = (record) => {
    const time = record.time.toISOString()
    const scope = record.scope ? ` [${record.scope}]` : ''
    const args =
        record.args.length > 0
            ? ` ${record.args.map(formatValue).join(' ')}`
            : ''
    const line = `[${time}] [${record.level.toUpperCase()}]${scope} ${record.message}${args}`

    if (record.level === 'error') {
        console.error(line)
    } else if (record.level === 'warn') {
        console.warn(line)
    } else if (record.level === 'debug') {
        console.debug(line)
    } else {
        console.info(line)
    }
}

export function isLogLevel(value: string): value is LogLevel {
    return (logLevels as readonly string[]).includes(value)
}

export function parseLogLevel(
    value: string | undefined,
    fallback: LogLevel = 'info'
): LogLevel {
    if (value === undefined || value.trim().length === 0) {
        return fallback
    }

    const normalized = value.trim().toLowerCase()

    if (!isLogLevel(normalized)) {
        throw new Error(
            `invalid log level: ${value} (expected ${logLevels.join(', ')})`
        )
    }

    return normalized
}

export function logLevelWeight(level: LogLevel): number {
    return LEVEL_WEIGHT[level]
}

export function createLogger(options: LoggerOptions = {}): Logger {
    const threshold = options.level ?? 'info'
    const scope = options.scope ?? 'bot'
    const sink = options.sink ?? defaultLogSink

    const emit = (level: LogLevel, message: string, args: unknown[]): void => {
        if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[threshold]) return

        sink({
            level,
            scope,
            message,
            args,
            time: new Date(),
        })
    }

    return {
        level: threshold,
        debug: (message, ...args) => emit('debug', message, args),
        info: (message, ...args) => emit('info', message, args),
        warn: (message, ...args) => emit('warn', message, args),
        error: (message, ...args) => emit('error', message, args),
        child: (childScope) =>
            createLogger({
                level: threshold,
                scope: scope ? `${scope}:${childScope}` : childScope,
                sink,
            }),
    }
}

export function createSilentLogger(scope = 'test'): Logger {
    return createLogger({
        scope,
        sink: () => {},
    })
}
