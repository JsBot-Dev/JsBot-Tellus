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
import { PluginHost, sortPlugins } from '../../src/core/plugin/host.js'
import { createDisabledInstaller } from '../../src/core/plugin/installer.js'
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
import { FakeEventContext } from '../helpers/event-context.js'
import { groupMessage, privateMessage } from '../helpers/events.js'
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
    configs: Record<string, PluginEnvelope> = {},
    options: {
        configErrors?: Record<string, string>
        configPaths?: Record<string, string>
    } = {}
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
        installer: createDisabledInstaller(),
        restart: () => {},
        uptime: () => 0,
    }

    const host = new PluginHost({
        definitions,
        configs,
        ...(options.configErrors !== undefined
            ? { configErrors: options.configErrors }
            : {}),
        ...(options.configPaths !== undefined
            ? { configPaths: options.configPaths }
            : {}),
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

    it('warns and ignores config for unknown plugin ids', async () => {
        const { host, records, database } = harness([makePlugin('a')], {
            missing: envelope({}),
        })

        databases.push(database)

        await host.setup()

        expect(
            records.some(
                (record) =>
                    record.level === 'warn' &&
                    record.message.includes(
                        'ignoring config for unknown plugin id: missing'
                    )
            )
        ).toBe(true)
        expect(host.listStatus()).toEqual([
            { id: 'a', enabled: true, loaded: true },
        ])
    })

    it('warns and skips plugins with invalid config', async () => {
        const setup = vi.fn()
        const { host, records, database } = harness(
            [
                makePlugin('bad', {
                    schema: z.object({ count: z.number() }).strict(),
                    setup,
                }),
            ],
            {
                bad: envelope({ count: 'nope' }),
            },
            {
                configPaths: {
                    bad: '/data/config/plugin/bad.jsonc',
                },
            }
        )

        databases.push(database)

        await host.setup()

        expect(setup).not.toHaveBeenCalled()
        expect(host.listStatus()).toEqual([
            { id: 'bad', enabled: true, loaded: false },
        ])
        expect(
            records.some(
                (record) =>
                    record.level === 'warn' &&
                    record.message.includes('invalid config for plugin bad') &&
                    record.message.includes('/data/config/plugin/bad.jsonc') &&
                    record.message.includes('bad.count')
            )
        ).toBe(true)
    })

    it('warns and skips plugins with config read errors', async () => {
        const setup = vi.fn()
        const { host, records, database } = harness(
            [makePlugin('bad', { setup })],
            {},
            {
                configErrors: {
                    bad: 'invalid JSONC in /data/config/plugin/bad.jsonc',
                },
            }
        )

        databases.push(database)

        await host.setup()

        expect(setup).not.toHaveBeenCalled()
        expect(
            records.some(
                (record) =>
                    record.level === 'warn' &&
                    record.message.includes(
                        'skipping plugin bad: invalid JSONC'
                    )
            )
        ).toBe(true)
    })

    it('skips plugins whose missing config fails the schema', async () => {
        const setup = vi.fn()
        const { host, records, database } = harness(
            [
                makePlugin('needs-config', {
                    schema: z.object({ token: z.string() }).strict(),
                    setup,
                }),
            ],
            {},
            {
                configPaths: {
                    'needs-config': '/data/config/plugin/needs-config.jsonc',
                },
            }
        )

        databases.push(database)

        await host.setup()

        expect(setup).not.toHaveBeenCalled()
        expect(
            records.some(
                (record) =>
                    record.level === 'warn' &&
                    record.message.includes('missing or empty config') &&
                    record.message.includes(
                        '/data/config/plugin/needs-config.jsonc'
                    )
            )
        ).toBe(true)
    })

    it('loads plugins with schema defaults when config is missing', async () => {
        const setup = vi.fn()
        const { host, database } = harness([
            makePlugin('defaults', {
                schema: z.object({ count: z.number().default(3) }).strict(),
                setup,
            }),
        ])

        databases.push(database)

        await host.setup()

        expect(setup).toHaveBeenCalledTimes(1)
        expect(host.listStatus()).toEqual([
            { id: 'defaults', enabled: true, loaded: true },
        ])
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

    it('registers scoped message handlers from plugin context', async () => {
        const group = vi.fn(async () => {})
        const privateHandler = vi.fn(async () => {})
        const { host, router, database } = harness([
            makePlugin('scoped', {
                setup: (context) => {
                    context.events.onGroupMessage(group)
                    context.events.onPrivateMessage(privateHandler)
                },
            }),
        ])

        databases.push(database)

        await host.setup()
        await host.start()

        const groupEvent = groupMessage()
        await router.dispatch(
            groupEvent,
            new FakeEventContext(groupEvent),
            async () => {}
        )

        expect(group).toHaveBeenCalledTimes(1)
        expect(privateHandler).not.toHaveBeenCalled()

        group.mockClear()

        const privateEvent = privateMessage()
        await router.dispatch(
            privateEvent,
            new FakeEventContext(privateEvent),
            async () => {}
        )

        expect(group).not.toHaveBeenCalled()
        expect(privateHandler).toHaveBeenCalledTimes(1)
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

        expect(stop).not.toHaveBeenCalled()
        expect(router.listCommands()).toEqual([])
    })

    it('does not stop plugins that never started', async () => {
        const badStop = vi.fn()
        const goodStop = vi.fn()
        const bad = makePlugin('bad', {
            priority: 100,
            start: async () => {
                throw new Error('start failed')
            },
            stop: badStop,
        })
        const good = makePlugin('good', { priority: 10, stop: goodStop })
        const { host, database } = harness([bad, good])

        databases.push(database)

        await host.setup()

        await expect(host.start()).rejects.toThrow('start failed')

        expect(badStop).not.toHaveBeenCalled()
        expect(goodStop).not.toHaveBeenCalled()
    })

    it('stops plugins that started before a later start failure', async () => {
        const goodStop = vi.fn()
        const good = makePlugin('good', { priority: 100, stop: goodStop })
        const bad = makePlugin('bad', {
            priority: 10,
            start: async () => {
                throw new Error('start failed')
            },
            stop: vi.fn(),
        })
        const { host, database } = harness([good, bad])

        databases.push(database)

        await host.setup()

        await expect(host.start()).rejects.toThrow('start failed')

        expect(goodStop).toHaveBeenCalledTimes(1)
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
