import { describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../../src/core/config/schema.js'
import type { Database } from '../../src/core/storage/database.js'
import { Kernel } from '../../src/core/kernel.js'
import { FakeClient } from '../helpers/fake-client.js'
import { FakeEventContext } from '../helpers/event-context.js'
import { groupMessage } from '../helpers/events.js'
import { createCapturingLogger, createTestLogger } from '../helpers/loggers.js'

const config: AppConfig = {
    url: 'ws://127.0.0.1:3001/',
    roles: {
        superadmin: [],
        admin: [],
    },
    message: {
        charThreshold: 50,
        lineThreshold: 3,
    },
    plugins: {},
    installer: {
        enabled: true,
        registry: 'https://registry.npmjs.org/',
        allowedPackages: [],
        allowScripts: false,
        timeoutMs: 120_000,
    },
}

function createFakeDatabase(): {
    database: Database
    close: ReturnType<typeof vi.fn>
} {
    const close = vi.fn()

    return {
        database: {
            connection: null as never,
            close,
        },
        close,
    }
}

function createKernel(
    client = new FakeClient(),
    database = createFakeDatabase()
) {
    return {
        kernel: new Kernel({
            config,
            client,
            logger: createTestLogger('kernel'),
            database: database.database,
        }),
        client,
        database,
    }
}

async function dispatch(
    client: FakeClient,
    next: () => Promise<void>
): Promise<void> {
    const event = groupMessage()
    const context = new FakeEventContext(event)
    const middleware = client.middlewares[0]

    expect(middleware).toBeDefined()

    await middleware?.(event, context, next)
}

describe('kernel', () => {
    it('registers exactly one middleware', () => {
        const { client } = createKernel()

        expect(client.middlewares).toHaveLength(1)
    })

    it('does not accept events before start', async () => {
        const { client } = createKernel()
        const next = vi.fn(async () => {})

        await dispatch(client, next)

        expect(next).not.toHaveBeenCalled()
    })

    it('connects and opens the router gate', async () => {
        const { kernel, client } = createKernel()
        const next = vi.fn(async () => {})

        await kernel.start()

        expect(kernel.state).toBe('running')
        expect(client.connected).toBe(true)
        expect(client.connectCalls).toBe(1)

        await dispatch(client, next)

        expect(next).toHaveBeenCalledTimes(1)
    })

    it('pauses and resumes event dispatch', async () => {
        const { kernel, client } = createKernel()
        const next = vi.fn(async () => {})

        await kernel.start()

        kernel.pause()
        await dispatch(client, next)

        expect(next).not.toHaveBeenCalled()

        kernel.resume()
        await dispatch(client, next)

        expect(next).toHaveBeenCalledTimes(1)

        await kernel.stop()
    })

    it('waits for in-flight dispatch before draining', async () => {
        const { kernel, client } = createKernel()
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const next = vi.fn(async () => {
            await gate
        })

        await kernel.start()

        const dispatching = dispatch(client, next)

        expect(await kernel.drain(20)).toBe(false)

        release()
        await dispatching

        expect(await kernel.drain()).toBe(true)

        await kernel.stop()
    })

    it('shares concurrent start calls', async () => {
        const { kernel, client } = createKernel()

        const first = kernel.start()
        const second = kernel.start()

        expect(second).toBe(first)

        await first

        expect(client.connectCalls).toBe(1)
    })

    it('closes the client and database on stop', async () => {
        const { kernel, client, database } = createKernel()
        const next = vi.fn(async () => {})

        await kernel.start()
        await kernel.stop()

        expect(kernel.state).toBe('stopped')
        expect(client.closeCalls).toBe(1)
        expect(database.close).toHaveBeenCalledTimes(1)

        await dispatch(client, next)

        expect(next).not.toHaveBeenCalled()
    })

    it('stops idempotently', async () => {
        const { kernel, client, database } = createKernel()

        await kernel.start()
        await Promise.all([kernel.stop(), kernel.stop()])

        expect(client.closeCalls).toBe(1)
        expect(database.close).toHaveBeenCalledTimes(1)
        expect(kernel.state).toBe('stopped')
    })

    it('rolls back when connect fails', async () => {
        const client = new FakeClient({
            connectError: new Error('connect failed'),
        })
        const { kernel, database } = createKernel(client)

        await expect(kernel.start()).rejects.toThrow('connect failed')

        expect(kernel.state).toBe('failed')
        expect(client.closeCalls).toBe(1)
        expect(database.close).toHaveBeenCalledTimes(1)

        await kernel.stop()

        expect(kernel.state).toBe('stopped')
        expect(client.closeCalls).toBe(1)
        expect(database.close).toHaveBeenCalledTimes(1)
    })

    it('still closes the database when client close fails', async () => {
        const client = new FakeClient({
            closeError: new Error('close failed'),
        })
        const { logger, records } = createCapturingLogger('kernel')
        const database = createFakeDatabase()
        const kernel = new Kernel({
            config,
            client,
            logger,
            database: database.database,
        })

        await kernel.start()
        await kernel.stop()

        expect(kernel.state).toBe('stopped')
        expect(database.close).toHaveBeenCalledTimes(1)
        expect(
            records.some((record) => record.message === 'client close failed')
        ).toBe(true)
    })

    it('still stops when the database close fails', async () => {
        const client = new FakeClient()
        const { logger, records } = createCapturingLogger('kernel')
        const close = vi.fn(() => {
            throw new Error('db close failed')
        })
        const database: Database = {
            connection: null as never,
            close,
        }
        const kernel = new Kernel({
            config,
            client,
            logger,
            database,
        })

        await kernel.start()
        await kernel.stop()

        expect(kernel.state).toBe('stopped')
        expect(client.closeCalls).toBe(1)
        expect(
            records.some((record) => record.message === 'database close failed')
        ).toBe(true)
    })
})
