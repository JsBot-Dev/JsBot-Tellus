import { describe, expect, it } from 'vitest'
import { LogBuffer } from '../../src/core/logging/log-buffer.js'
import type { LogRecord } from '../../src/core/logging/logger.js'

function record(
    message: string,
    level: LogRecord['level'] = 'info',
    scope = 'app'
): LogRecord {
    return {
        level,
        scope,
        message,
        args: [],
        time: new Date(),
    }
}

describe('log buffer', () => {
    it('keeps a bounded ring of entries', () => {
        const buffer = new LogBuffer(3)

        buffer.push(record('one'))
        buffer.push(record('two'))
        buffer.push(record('three'))
        buffer.push(record('four'))

        expect(buffer.list().map((entry) => entry.message)).toEqual([
            'two',
            'three',
            'four',
        ])
    })

    it('filters by minimum level, scope and query', () => {
        const buffer = new LogBuffer()

        buffer.push(record('debug', 'debug', 'app:router'))
        buffer.push(record('info', 'info', 'app:kernel'))
        buffer.push(record('warn', 'warn', 'app:router'))
        buffer.push(record('error', 'error', 'plugin:llm'))

        expect(
            buffer.list({ level: 'warn' }).map((entry) => entry.message)
        ).toEqual(['warn', 'error'])
        expect(
            buffer.list({ scope: 'app:router' }).map((entry) => entry.message)
        ).toEqual(['debug', 'warn'])
        expect(
            buffer.list({ query: 'KERNEL' }).map((entry) => entry.message)
        ).toEqual(['info'])
    })

    it('formats arguments and notifies subscribers', () => {
        const buffer = new LogBuffer()
        const seen: string[] = []
        const unsubscribe = buffer.subscribe((entry) => {
            seen.push(`${entry.level}:${entry.message}:${entry.args.join(',')}`)
        })

        buffer.push({
            level: 'error',
            scope: 'app',
            message: 'failed',
            args: [new Error('boom'), 42],
            time: new Date(),
        })

        expect(seen).toHaveLength(1)
        expect(seen[0]).toContain('error:failed:')
        expect(seen[0]).toContain('42')
        expect(buffer.list()[0]?.args[1]).toBe('42')

        unsubscribe()
        buffer.push(record('after'))
        expect(seen).toHaveLength(1)
    })

    it('clears entries', () => {
        const buffer = new LogBuffer()

        buffer.push(record('one'))
        buffer.clear()

        expect(buffer.list()).toEqual([])
        expect(buffer.size).toBe(0)
    })
})
