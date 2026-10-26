import { z } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBotApi } from '../../src/core/api.js'
import {
    pluginEnvelopeSchema,
    type PluginEnvelope,
} from '../../src/core/config/schema.js'
import { Router } from '../../src/core/dispatch/router.js'
import { PerKeyTaskQueue } from '../../src/core/dispatch/task-queue.js'
import { createMessageSender } from '../../src/core/messaging/sender.js'
import { createPluginContext } from '../../src/core/plugin/context.js'
import { PluginGate } from '../../src/core/plugin/gating.js'
import {
    PluginConfigError,
    PluginHost,
    sortPlugins,
} from '../../src/core/plugin/host.js'
import { SqlitePluginKV } from '../../src/core/plugin/kv.js'
import type {
    AnyPluginDefinition,
    CoreServices,
    PluginContext,
} from '../../src/core/plugin/types.js'
import { RoleService } from '../../src/core/security/roles.js'
import { openMemoryDatabase } from '../../src/core/storage/database.js'
import { SqliteSessionStore } from '../../src/core/storage/session.js'
import { FakeClient } from '../helpers/fake-client.js'
import { createCapturingLogger } from '../helpers/loggers.js'

function envelope(value: Record<string, unknown>): PluginEnvelope {
    return pluginEnvelopeSchema.parse(value)
}

function makePlugin(
    id: string,
    options: {
        defaultEnabled?: boolean
        dependencies?: string[]
        priority?: number
        schema?: z.ZodType<unknown>
        setup?: (context: PluginContext<unknown>) => unknown | Promise<unknown>
        start?: (state: unknown) => void | Promise<void>
        stop?: (state: unknown) => void | Promise<void>
    } = {}
): AnyPluginDefinition {
    return {
        manifest: {
            id,
            version: '1.0.0',
            defaultEnabled: options.defaultEnabled ?? true,
            ...(options.dependencies !== undefined
                ? { dependencies: options.dependencies }
                : {}),
            ...(options.priority !== undefined
                ? { priority: options.priority }
                : {}),
            configSchema: options.schema ?? z.object({}).strict(),
        },
        setup: options.setup ?? (() => {}),
        ...(options.start !== undefined ? { start: options.start } : {}),
        ...(options.stop !== undefined ? { stop: options.stop } : {}),
    }
}

function harness(
    definitions: AnyPluginDefinition[],
    configs: Record<string, PluginEnvelope> = {}
) {
    const { logger, records } = createCapturingLogger()
    const client = new FakeClient()
    const roles = new RoleService({
        superadmin: [],
        admin: [],
    })
    const gate = new PluginGate(definitions, configs)
    const sender = createMessageSender({
        client,
        message: { charThreshold: 100, lineThreshold: 5 },
        logger,
    })
    const router = new Router({
        sender,
        roles,
        gate,
        logger,
    })
    const database = openMemoryDatabase()
    const sessions = new SqliteSessionStore(database)
    const tasks = new PerKeyTaskQueue(logger)
    const api = createBotApi(client, sender)
    const core: CoreServices = {
        roles: {
            roleOf: (userId) => roles.roleOf(userId),
            can: (actual, required) => roles.can(actual, required),
        },
        commands: {
            list: () => router.listCommands(),
        },
        plugins: {
            list: () => [],
        },
        uptime: () => 0,
    }

    const host = new PluginHost({
        definitions,
        configs,
        gate,
        router,
        logger,
        createContext: (definition, config) =>
            createPluginContext(definition, {
                config,
                router,
                logger,
                core,
                kv: new SqlitePluginKV(database, definition.manifest.id),
                sessions,
                tasks,
                api,
            }),
    })

    router.accepting = true

    return {
        host,
        router,
        database,
        records,
    }
}

const databases: Array<{ close(): void }> = []

afterEach(() => {
    for (const database of databases) {
        database.close()
    }

    databases.length = 0
})

describe('plugin host', () => {
    it('sorts by dependencies before priority', () => {
        const low = makePlugin('low', { priority: 10 })
        const high = makePlugin('high', {
            priority: 100,
            dependencies: ['low'],
        })
        const middle = makePlugin('middle', { priority: 50 })

        expect(
            sortPlugins([low, high, middle]).map((plugin) => plugin.manifest.id)
        ).toEqual(['low', 'high', 'middle'])
    })

    it('rejects duplicate ids', () => {
        expect(() => sortPlugins([makePlugin('a'), makePlugin('a')])).toThrow(
            /duplicate plugin id/
        )
    })

    it('rejects missing dependencies', () => {
        expect(() =>
            sortPlugins([makePlugin('a', { dependencies: ['missing'] })])
        ).toThrow(/requires missing/)
    })

    it('rejects dependency cycles', () => {
        expect(() =>
            sortPlugins([
                makePlugin('a', { dependencies: ['b'] }),
                makePlugin('b', { dependencies: ['a'] }),
            ])
        ).toThrow(/dependency cycle/)
    })

    it('rejects unknown plugin config ids', async () => {
        const { host, database } = harness([makePlugin('a')], {
            missing: envelope({}),
        })

        databases.push(database)

        await expect(host.setup()).rejects.toThrow(/unknown plugin id: missing/)
    })

    it('reports plugin config paths', async () => {
        const { host, database } = harness(
            [
                makePlugin('bad', {
                    schema: z.object({ count: z.number() }).strict(),
                }),
            ],
            {
                bad: envelope({ count: 'nope' }),
            }
        )

        databases.push(database)

        await expect(host.setup()).rejects.toBeInstanceOf(PluginConfigError)
        await expect(host.setup()).rejects.toThrow(/plugins\.bad\.count/)
    })

    it('skips disabled plugins', async () => {
        const setup = vi.fn()
        const { host, database } = harness([makePlugin('off', { setup })], {
            off: envelope({ enabled: false }),
        })

        databases.push(database)

        await host.setup()
        await host.start()

        expect(setup).not.toHaveBeenCalled()
        expect(host.listStatus()).toEqual([
            {
                id: 'off',
                enabled: false,
                loaded: false,
            },
        ])
    })

    it('runs setup, start and stop in order', async () => {
        const order: string[] = []
        const high = makePlugin('high', {
            priority: 100,
            setup: () => {
                order.push('setup high')
            },
            start: () => {
                order.push('start high')
            },
            stop: () => {
                order.push('stop high')
            },
        })
        const low = makePlugin('low', {
            priority: 10,
            setup: () => {
                order.push('setup low')
            },
            start: () => {
                order.push('start low')
            },
            stop: () => {
                order.push('stop low')
            },
        })
        const { host, database } = harness([low, high])

        databases.push(database)

        await host.setup()
        await host.start()
        await host.stop()

        expect(order).toEqual([
            'setup high',
            'setup low',
            'start high',
            'start low',
            'stop low',
            'stop high',
        ])
    })

    it('rolls back setup failures', async () => {
        const stop = vi.fn()
        const good = makePlugin('good', {
            priority: 100,
            setup: (context) => {
                context.commands.register({ name: 'from-good' }, async () => {})
            },
            stop,
        })
        const bad = makePlugin('bad', {
            priority: 10,
            setup: async () => {
                throw new Error('setup failed')
            },
        })
        const { host, router, database } = harness([good, bad])

        databases.push(database)

        await expect(host.setup()).rejects.toThrow('setup failed')

        expect(stop).toHaveBeenCalledTimes(1)
        expect(router.listCommands()).toEqual([])
    })

    it('rolls back start failures', async () => {
        const stop = vi.fn()
        const bad = makePlugin('bad', {
            priority: 100,
            start: async () => {
                throw new Error('start failed')
            },
            stop,
        })
        const good = makePlugin('good', { priority: 10 })
        const { host, database } = harness([bad, good])

        databases.push(database)

        await host.setup()

        await expect(host.start()).rejects.toThrow('start failed')

        expect(stop).toHaveBeenCalledTimes(1)
    })

    it('isolates stop failures', async () => {
        const goodStop = vi.fn()
        const bad = makePlugin('bad', {
            priority: 100,
            stop: () => {
                throw new Error('stop failed')
            },
        })
        const good = makePlugin('good', {
            priority: 10,
            stop: goodStop,
        })
        const { host, records, database } = harness([good, bad])

        databases.push(database)

        await host.setup()
        await host.start()
        await host.stop()

        expect(goodStop).toHaveBeenCalledTimes(1)
        expect(
            records.some(
                (record) => record.message === 'plugin bad stop failed'
            )
        ).toBe(true)
    })

    it('reports loaded state', async () => {
        const { host, database } = harness([
            makePlugin('a'),
            makePlugin('b', { defaultEnabled: false }),
        ])

        databases.push(database)

        await host.setup()

        expect(host.listStatus()).toEqual([
            { id: 'a', enabled: true, loaded: true },
            { id: 'b', enabled: false, loaded: false },
        ])
    })
})
