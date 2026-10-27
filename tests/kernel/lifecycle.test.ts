import { describe, expect, it, vi } from 'vitest'
import { Lifecycle } from '../../src/core/lifecycle/lifecycle.js'

interface Deferred {
    promise: Promise<void>
    resolve(): void
    reject(error: unknown): void
}

function deferred(): Deferred {
    let resolve!: () => void
    let reject!: (error: unknown) => void

    const promise = new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
    })

    return { promise, resolve, reject }
}

describe('lifecycle', () => {
    it('starts and stops in order', async () => {
        const calls: string[] = []
        const lifecycle = new Lifecycle({
            onStart: async () => {
                calls.push('start')
            },
            onStop: async () => {
                calls.push('stop')
            },
        })

        expect(lifecycle.state).toBe('idle')

        await lifecycle.start()

        expect(lifecycle.state).toBe('running')
        expect(calls).toEqual(['start'])

        await lifecycle.stop()

        expect(lifecycle.state).toBe('stopped')
        expect(calls).toEqual(['start', 'stop'])
    })

    it('reuses the same start promise', async () => {
        const gate = deferred()
        const lifecycle = new Lifecycle({
            onStart: async () => {
                await gate.promise
            },
            onStop: async () => {},
        })

        const first = lifecycle.start()
        const second = lifecycle.start()

        expect(second).toBe(first)

        gate.resolve()
        await first

        expect(lifecycle.state).toBe('running')
    })

    it('stops idempotently', async () => {
        const onStop = vi.fn(async () => {})
        const lifecycle = new Lifecycle({
            onStart: async () => {},
            onStop,
        })

        await lifecycle.start()
        await Promise.all([lifecycle.stop(), lifecycle.stop()])

        expect(onStop).toHaveBeenCalledTimes(1)
        expect(lifecycle.state).toBe('stopped')
    })

    it('waits for start before stopping', async () => {
        const gate = deferred()
        const onStop = vi.fn(async () => {})
        const lifecycle = new Lifecycle({
            onStart: async () => {
                await gate.promise
            },
            onStop,
        })

        const started = lifecycle.start()
        const stopped = lifecycle.stop()

        await Promise.resolve()

        expect(onStop).not.toHaveBeenCalled()

        gate.resolve()

        await started
        await stopped

        expect(onStop).toHaveBeenCalledTimes(1)
        expect(lifecycle.state).toBe('stopped')
    })

    it('marks a failed start and does not call onStop', async () => {
        const onStop = vi.fn(async () => {})
        const lifecycle = new Lifecycle({
            onStart: async () => {
                throw new Error('start failed')
            },
            onStop,
        })

        await expect(lifecycle.start()).rejects.toThrow('start failed')

        expect(lifecycle.state).toBe('failed')

        await lifecycle.stop()

        expect(lifecycle.state).toBe('stopped')
        expect(onStop).not.toHaveBeenCalled()
    })

    it('cancels a start that fails while stopping', async () => {
        const gate = deferred()
        const onStop = vi.fn(async () => {})
        const lifecycle = new Lifecycle({
            onStart: async () => {
                await gate.promise
            },
            onStop,
        })

        const started = lifecycle.start()
        const stopped = lifecycle.stop()

        gate.reject(new Error('connect failed'))

        await expect(started).rejects.toThrow('connect failed')
        await stopped

        expect(lifecycle.state).toBe('stopped')
        expect(onStop).not.toHaveBeenCalled()
    })

    it('cannot start after stop', async () => {
        const lifecycle = new Lifecycle({
            onStart: async () => {},
            onStop: async () => {},
        })

        await lifecycle.start()
        await lifecycle.stop()

        await expect(lifecycle.start()).rejects.toThrow(
            /cannot start lifecycle/
        )
    })

    it('stopping before start makes start impossible', async () => {
        const onStop = vi.fn(async () => {})
        const lifecycle = new Lifecycle({
            onStart: async () => {},
            onStop,
        })

        await lifecycle.stop()

        expect(lifecycle.state).toBe('stopped')
        expect(onStop).toHaveBeenCalledTimes(1)

        await expect(lifecycle.start()).rejects.toThrow(
            /cannot start lifecycle/
        )
    })

    it('still reaches stopped when onStop throws', async () => {
        const lifecycle = new Lifecycle({
            onStart: async () => {},
            onStop: async () => {
                throw new Error('stop failed')
            },
        })

        await lifecycle.start()

        await expect(lifecycle.stop()).rejects.toThrow('stop failed')

        expect(lifecycle.state).toBe('stopped')

        await expect(lifecycle.stop()).resolves.toBeUndefined()
    })
})
