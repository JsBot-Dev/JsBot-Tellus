import {
    formatValue,
    logLevelWeight,
    type LogLevel,
    type LogRecord,
} from './logger.js'

export interface LogEntry {
    time: number
    level: LogLevel
    scope: string
    message: string
    args: string[]
}

export interface LogFilter {
    level?: LogLevel | undefined
    scope?: string | undefined
    query?: string | undefined
    limit?: number | undefined
}

export function matchesLogFilter(entry: LogEntry, filter: LogFilter): boolean {
    if (
        filter.level !== undefined &&
        logLevelWeight(entry.level) < logLevelWeight(filter.level)
    ) {
        return false
    }

    if (
        filter.scope !== undefined &&
        filter.scope.length > 0 &&
        entry.scope !== filter.scope
    ) {
        return false
    }

    if (filter.query !== undefined && filter.query.length > 0) {
        const query = filter.query.toLowerCase()
        const haystack = [entry.scope, entry.message, ...entry.args]
            .join(' ')
            .toLowerCase()

        if (!haystack.includes(query)) return false
    }

    return true
}

export class LogBuffer {
    private readonly entries: LogEntry[] = []
    private readonly listeners = new Set<(entry: LogEntry) => void>()

    constructor(private readonly capacity = 2_000) {}

    get size(): number {
        return this.entries.length
    }

    push(record: LogRecord): void {
        const entry: LogEntry = {
            time: record.time.getTime(),
            level: record.level,
            scope: record.scope,
            message: record.message,
            args: record.args.map(formatValue),
        }

        this.entries.push(entry)

        if (this.entries.length > this.capacity) {
            this.entries.splice(0, this.entries.length - this.capacity)
        }

        for (const listener of this.listeners) {
            try {
                listener(entry)
            } catch {
                // Log consumers must never break logging.
            }
        }
    }

    list(filter: LogFilter = {}): LogEntry[] {
        const matched = this.entries.filter((entry) =>
            matchesLogFilter(entry, filter)
        )
        const limit = filter.limit

        if (limit === undefined || limit < 0 || limit >= matched.length) {
            return matched
        }

        return matched.slice(-limit)
    }

    clear(): void {
        this.entries.length = 0
    }

    subscribe(listener: (entry: LogEntry) => void): () => void {
        this.listeners.add(listener)

        return () => {
            this.listeners.delete(listener)
        }
    }
}
