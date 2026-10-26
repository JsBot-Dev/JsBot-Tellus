import { describe, expect, it } from 'vitest'
import { PerKeyTaskQueue } from '../../src/core/dispatch/task-queue.js'
import { createCapturingLogger } from '../helpers/loggers.js'

function deferred(): {
    promise: Promise<void>
    resolve(): void
} {
    let resolve!: () => void
    const promise = new Promise<void>((res) => {
        resolve = res
    })

    return { promise, resolve }
}

describe('task queue', () => {
    it('runs tasks with the same key serially', async () => {
        const { logger } = createCapturingLogger()
        const queue = new PerKeyTaskQueue(logger)
        const gate = deferred()
        const order: string[] = []

        queue.enqueue('a', async () => {
            order.push('first')
            await gate.promise
            order.push('first done')
        })
        queue.enqueue('a', async () => {
            order.push('second')
        })

        await Promise.resolve()
        await Promise.resolve()

        expect(order).toEqual(['first'])

        gate.resolve()
        await queue.drain()

        expect(order).toEqual(['first', 'first done', 'second'])
    })

    it('runs different keys concurrently', async () => {
        const { logger } = createCapturingLogger()
        const queue = new PerKeyTaskQueue(logger)
        const first = deferred()
        const second = deferred()
        const started: string[] = []

        queue.enqueue('a', async () => {
            started.push('a')
            await first.promise
        })
        queue.enqueue('b', async () => {
            started.push('b')
            await second.promise
        })

        await Promise.resolve()
        await Promise.resolve()

        expect(started.sort()).toEqual(['a', 'b'])

        first.resolve()
        second.resolve()

        expect(await queue.drain()).toBe(true)
    })

    it('reports a drain timeout', async () => {
        const { logger } = createCapturingLogger()
        const queue = new PerKeyTaskQueue(logger)
        let aborted = false

        queue.enqueue('a', async (signal) => {
            await new Promise<void>((resolve) => {
                signal.addEventListener('abort', () => {
                    aborted = true
                    resolve()
                })
            })
        })

        expect(await queue.drain(5)).toBe(false)

        queue.cancelAll()

        expect(aborted).toBe(true)
        expect(await queue.drain()).toBe(true)
    })

    it('cancels queued tasks', async () => {
        const { logger } = createCapturingLogger()
        const queue = new PerKeyTaskQueue(logger)
        const gate = deferred()
        const order: string[] = []

        queue.enqueue('a', async () => {
            order.push('first')
            await gate.promise
        })
        queue.enqueue('a', async () => {
            order.push('second')
        })

        await Promise.resolve()
        await Promise.resolve()

        queue.cancelAll()
        gate.resolve()

        expect(await queue.drain()).toBe(true)
        expect(order).toEqual(['first'])
    })

    it('logs task failures without rejecting drain', async () => {
        const { logger, records } = createCapturingLogger()
        const queue = new PerKeyTaskQueue(logger)

        queue.enqueue('a', async () => {
            throw new Error('boom')
        })

        expect(await queue.drain()).toBe(true)
        expect(records.at(-1)?.message).toBe('task failed: a')
    })
})
