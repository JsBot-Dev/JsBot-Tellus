import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import type { OneBotMessageEvent, SnowLumaEvent } from '@snowluma/sdk'
import type { PluginEnvelope } from '../../src/core/config/schema.js'
import { Router } from '../../src/core/dispatch/router.js'
import { createMessageSender } from '../../src/core/messaging/sender.js'
import { PluginGate } from '../../src/core/plugin/gating.js'
import {
    definePlugin,
    type AnyPluginDefinition,
    type CommandHandler,
} from '../../src/core/plugin/types.js'
import type { Permission } from '../../src/core/security/permission.js'
import { RoleService } from '../../src/core/security/roles.js'
import { FakeClient } from '../helpers/fake-client.js'
import { FakeEventContext } from '../helpers/event-context.js'
import { groupMessage, pokeNotice } from '../helpers/events.js'
import { createCapturingLogger } from '../helpers/loggers.js'

function plugin(id: string): AnyPluginDefinition {
    return definePlugin({
        manifest: {
            id,
            version: '1.0.0',
            defaultEnabled: true,
            configSchema: z.object({}).strict(),
        },
        setup() {},
    })
}

function harness(
    definitions: AnyPluginDefinition[] = [plugin('test'), plugin('other')],
    configs: Record<string, PluginEnvelope> = {}
) {
    const { logger, records } = createCapturingLogger()
    const client = new FakeClient()
    const roles = new RoleService({
        superadmin: [10000],
        admin: [20000],
    })
    const gate = new PluginGate(definitions, configs)
    const sender = createMessageSender({
        client,
        message: { charThreshold: 500, lineThreshold: 10 },
        logger,
    })
    const router = new Router({
        sender,
        roles,
        gate,
        logger,
    })

    router.accepting = true

    const dispatch = async (event: SnowLumaEvent) => {
        const context = new FakeEventContext(event)
        const next = vi.fn(async () => {})
        await router.dispatch(event, context, next)

        return { context, next }
    }

    return { router, client, dispatch, records }
}

describe('router', () => {
    it('does not dispatch while not accepting', async () => {
        const { router, dispatch } = harness()

        router.accepting = false

        const { next } = await dispatch(groupMessage())

        expect(next).not.toHaveBeenCalled()
    })

    it('runs a permitted command and stops propagation', async () => {
        const { router, dispatch } = harness()
        const handler = vi.fn<CommandHandler>(async () => {})

        router.registerCommand({
            pluginId: 'test',
            name: 'hello',
            aliases: ['hi'],
            handler,
        })

        const { context, next } = await dispatch(
            groupMessage({
                raw_message: '/hi there',
                user_id: 30000,
            })
        )

        expect(handler).toHaveBeenCalledTimes(1)

        const call = handler.mock.calls[0]
        const match = call?.[2] as { command: string; rest: string } | undefined

        expect(match?.command).toBe('hi')
        expect(match?.rest).toBe('there')
        expect(context.stopped).toBe(true)
        expect(next).not.toHaveBeenCalled()
    })

    it('dispatches group subcommands and generates group usage', async () => {
        const { router, dispatch } = harness()
        const child = vi.fn<CommandHandler>(async () => {})

        router.registerCommandGroup(
            {
                pluginId: 'test',
                name: 'group',
            },
            (group) => {
                group.register({ name: 'child', description: '子命令' }, child)
            }
        )

        const handled = await dispatch(
            groupMessage({
                raw_message: '/group child value',
                user_id: 30000,
            })
        )

        expect(child).toHaveBeenCalledTimes(1)
        expect(child.mock.calls[0]?.[2]).toEqual({
            command: 'group child',
            prefix: '/',
            args: ['value'],
            rest: 'value',
        })
        expect(handled.context.stopped).toBe(true)

        const usage = await dispatch(
            groupMessage({
                raw_message: '/group',
                user_id: 30000,
            })
        )

        expect(usage.context.stopped).toBe(true)
        expect(String(usage.context.replies.at(-1)?.message)).toContain(
            '用法：/group <child>'
        )
        expect(String(usage.context.replies.at(-1)?.message)).toContain(
            '/group child - 子命令'
        )
    })

    it('parses command params and ignores extra arguments', async () => {
        const { router, dispatch, records } = harness()
        const handler = vi.fn<
            CommandHandler<OneBotMessageEvent, [string, number]>
        >(async () => {})

        router.registerCommand({
            pluginId: 'test',
            name: 'ask',
            params: '<question:string> [count:number=1]',
            handler,
        })

        const { context } = await dispatch(
            groupMessage({
                raw_message: '/ask hello 3 extra',
                user_id: 30000,
            })
        )

        expect(handler).toHaveBeenCalledTimes(1)

        const call = handler.mock.calls[0]

        expect(call?.[3]).toBe('hello')
        expect(call?.[4]).toBe(3)
        expect(call?.[2]).toEqual({
            command: 'ask',
            prefix: '/',
            args: ['hello', '3', 'extra'],
            rest: 'hello 3 extra',
        })
        expect(context.stopped).toBe(true)
        expect(
            records.some((record) =>
                record.message.includes('ignored extra arguments')
            )
        ).toBe(true)
    })

    it('parses at params from raw messages', async () => {
        const { router, dispatch } = harness()
        const handler = vi.fn<
            CommandHandler<OneBotMessageEvent, [number, number]>
        >(async () => {})

        router.registerCommand({
            pluginId: 'test',
            name: 'ban',
            params: '<user:at> <duration:integer>',
            handler,
        })

        await dispatch(
            groupMessage({
                raw_message: '/ban [CQ:at,qq=123456] 60',
                user_id: 30000,
            })
        )

        expect(handler).toHaveBeenCalledTimes(1)
        expect(handler.mock.calls[0]?.[3]).toBe(123456)
        expect(handler.mock.calls[0]?.[4]).toBe(60)
    })

    it('replies with usage when required params are missing', async () => {
        const { router, dispatch, client } = harness()
        const handler = vi.fn(async () => {})

        router.registerCommand({
            pluginId: 'test',
            name: 'ask',
            params: '<question:string> [count:number=1]',
            handler,
        })

        const { context } = await dispatch(
            groupMessage({ raw_message: '/ask', user_id: 30000 })
        )

        expect(handler).not.toHaveBeenCalled()
        expect(context.stopped).toBe(true)
        expect(client.sent[0]?.message).toBe(
            '缺少参数：question\n用法：/ask <question> [count]'
        )
    })

    it('replies with usage when a declared param has the wrong type', async () => {
        const { router, dispatch, client } = harness()
        const handler = vi.fn(async () => {})

        router.registerCommand({
            pluginId: 'test',
            name: 'ask',
            params: '<question:string> [count:number=1]',
            handler,
        })

        await dispatch(
            groupMessage({ raw_message: '/ask hello abc', user_id: 30000 })
        )

        expect(handler).not.toHaveBeenCalled()
        expect(client.sent[0]?.message).toBe(
            '参数 count 需要是数字\n用法：/ask <question> [count]'
        )
    })

    it('parses params for group subcommands', async () => {
        const { router, dispatch } = harness()
        const handler = vi.fn<CommandHandler<OneBotMessageEvent, [string]>>(
            async () => {}
        )

        router.registerCommandGroup(
            {
                pluginId: 'test',
                name: 'demo',
            },
            (group) => {
                group.register(
                    {
                        name: 'ask',
                        params: '<question:text>',
                    },
                    handler
                )
            }
        )

        await dispatch(
            groupMessage({
                raw_message: '/demo ask hello world',
                user_id: 30000,
            })
        )

        expect(handler).toHaveBeenCalledTimes(1)
        expect(handler.mock.calls[0]?.[3]).toBe('hello world')
    })

    it('parses params for group roots', async () => {
        const { router, dispatch, client } = harness()
        const handler = vi.fn<CommandHandler<OneBotMessageEvent, [string]>>(
            async () => {}
        )

        router.registerCommandGroup(
            {
                pluginId: 'test',
                name: 'demo',
                params: '<target:string>',
                handler,
            },
            (group) => {
                group.register({ name: 'child' }, async () => {})
            }
        )

        await dispatch(
            groupMessage({ raw_message: '/demo alice', user_id: 30000 })
        )

        expect(handler).toHaveBeenCalledTimes(1)
        expect(handler.mock.calls[0]?.[3]).toBe('alice')

        await dispatch(groupMessage({ raw_message: '/demo', user_id: 30000 }))

        expect(client.sent.at(-1)?.message).toBe(
            '缺少参数：target\n用法：/demo <target>'
        )
    })

    it('leaves handlers without params unchanged', async () => {
        const { router, dispatch } = harness()
        const handler = vi.fn(async () => {})

        router.registerCommand({
            pluginId: 'test',
            name: 'plain',
            handler,
        })

        await dispatch(
            groupMessage({ raw_message: '/plain a b', user_id: 30000 })
        )

        expect(handler).toHaveBeenCalledTimes(1)
        expect(handler.mock.calls[0]).toHaveLength(3)
    })

    it('refuses commands above the user role', async () => {
        const { router, dispatch, client } = harness()
        const handler = vi.fn(async () => {})

        router.registerCommand({
            pluginId: 'test',
            name: 'admin',
            permission: 'Admin',
            params: '<value:string>',
            handler,
        })

        await dispatch(
            groupMessage({
                raw_message: '/admin',
                user_id: 30000,
            })
        )

        expect(handler).not.toHaveBeenCalled()
        expect(client.sent[0]?.message).toBe('权限不足：需要 Admin，当前 User')
    })

    it('allows users with the required role', async () => {
        for (const [userId, required] of [
            [20000, 'Admin'],
            [10000, 'SuperAdmin'],
        ] as Array<[number, Permission]>) {
            const { router, dispatch } = harness()
            const handler = vi.fn(async () => {})

            router.registerCommand({
                pluginId: 'test',
                name: 'cmd',
                permission: required,
                handler,
            })

            await dispatch(
                groupMessage({
                    raw_message: '/cmd',
                    user_id: userId,
                })
            )

            expect(handler).toHaveBeenCalledTimes(1)
        }
    })

    it('does not leak disabled commands into message handlers', async () => {
        const configs = {
            test: {
                enabled: false,
                private: true,
                groups: { allow: [], deny: [] },
            },
        } as Record<string, PluginEnvelope>
        const { router, dispatch } = harness([plugin('test')], configs)
        const command = vi.fn(async () => {})
        const message = vi.fn(async () => {})

        router.registerCommand({
            pluginId: 'test',
            name: 'hidden',
            handler: command,
        })
        router.registerMessage('test', message)

        const { context } = await dispatch(
            groupMessage({ raw_message: '/hidden' })
        )

        expect(command).not.toHaveBeenCalled()
        expect(message).not.toHaveBeenCalled()
        expect(context.stopped).toBe(true)
    })

    it('reports command handler failures', async () => {
        const { router, dispatch, records } = harness()

        router.registerCommand({
            pluginId: 'test',
            name: 'boom',
            handler: async () => {
                throw new Error('command failed')
            },
        })

        await expect(
            dispatch(groupMessage({ raw_message: '/boom' }))
        ).resolves.toBeDefined()

        expect(
            records.some((record) => record.message.includes('command failed'))
        ).toBe(true)
    })

    it('runs middlewares by priority', async () => {
        const { router, dispatch } = harness()
        const order: string[] = []

        router.registerMiddleware({
            pluginId: 'test',
            priority: 10,
            handler: async (_event, _context, next) => {
                order.push('low')
                await next()
            },
        })
        router.registerMiddleware({
            pluginId: 'other',
            priority: 100,
            handler: async (_event, _context, next) => {
                order.push('high')
                await next()
            },
        })

        await dispatch(groupMessage())

        expect(order).toEqual(['high', 'low'])
    })

    it('runs message middlewares for message_sent events', async () => {
        const { router, dispatch } = harness()
        const handler = vi.fn(async () => {})

        router.registerMiddleware({
            pluginId: 'test',
            handler,
        })

        await dispatch(groupMessage({ post_type: 'message_sent' }))

        expect(handler).toHaveBeenCalledTimes(1)
    })

    it('continues after a middleware error', async () => {
        const { router, dispatch, records } = harness()
        const order: string[] = []

        router.registerMiddleware({
            pluginId: 'test',
            priority: 100,
            handler: async () => {
                throw new Error('middleware failed')
            },
        })
        router.registerMiddleware({
            pluginId: 'other',
            priority: 10,
            handler: async (_event, _context, next) => {
                order.push('after')
                await next()
            },
        })

        await dispatch(groupMessage())

        expect(order).toEqual(['after'])
        expect(
            records.some((record) =>
                record.message.includes('middleware failed')
            )
        ).toBe(true)
    })

    it('runs next at most once', async () => {
        const { router, dispatch } = harness()
        const first = vi.fn(async () => {})

        router.registerMiddleware({
            pluginId: 'test',
            priority: 100,
            handler: async (_event, _context, next) => {
                await next()
                await next()
            },
        })
        router.registerMiddleware({
            pluginId: 'other',
            priority: 10,
            handler: first,
        })

        await dispatch(groupMessage())

        expect(first).toHaveBeenCalledTimes(1)
    })

    it('stops handlers when a middleware stops propagation', async () => {
        const { router, dispatch } = harness()
        const handler = vi.fn(async () => {})

        router.registerMiddleware({
            pluginId: 'test',
            priority: 100,
            handler: async (_event, context) => {
                context.stopPropagation()
            },
        })
        router.registerMessage('other', handler)

        await dispatch(groupMessage())

        expect(handler).not.toHaveBeenCalled()
    })

    it('runs message handlers for non-command messages', async () => {
        const { router, dispatch } = harness()
        const handler = vi.fn(async () => {})

        router.registerMessage('test', handler)

        await dispatch(groupMessage({ raw_message: 'hello' }))

        expect(handler).toHaveBeenCalledTimes(1)
    })

    it('filters notices by type and subtype', async () => {
        const { router, dispatch } = harness()
        const handler = vi.fn(async () => {})

        router.registerNotice({
            pluginId: 'test',
            noticeType: 'notify',
            subType: 'poke',
            handler,
        })

        await dispatch(pokeNotice())
        expect(handler).toHaveBeenCalledTimes(1)

        await dispatch(pokeNotice({ notice_type: 'group_increase' }))
        expect(handler).toHaveBeenCalledTimes(1)
    })

    it('filters requests by type', async () => {
        const { router, dispatch } = harness()
        const handler = vi.fn(async () => {})

        router.registerRequest({
            pluginId: 'test',
            requestType: 'friend',
            handler,
        })

        const friend = {
            time: 1,
            self_id: 10000,
            post_type: 'request',
            request_type: 'friend',
            flag: 'a',
            user_id: 1,
        } as SnowLumaEvent
        const group = {
            ...friend,
            request_type: 'group',
        } as SnowLumaEvent

        await dispatch(friend)
        await dispatch(group)

        expect(handler).toHaveBeenCalledTimes(1)
    })

    it('isolates handler failures', async () => {
        const { router, dispatch } = harness()
        const second = vi.fn(async () => {})

        router.registerMessage('test', async () => {
            throw new Error('handler failed')
        })
        router.registerMessage('other', second)

        await dispatch(groupMessage())

        expect(second).toHaveBeenCalledTimes(1)
    })

    it('applies gating to handlers', async () => {
        const configs = {
            other: {
                enabled: true,
                private: true,
                groups: { allow: [], deny: [123456] },
            },
        } as Record<string, PluginEnvelope>
        const { router, dispatch } = harness(
            [plugin('test'), plugin('other')],
            configs
        )
        const blocked = vi.fn(async () => {})

        router.registerMessage('other', blocked)

        await dispatch(groupMessage({ group_id: 123456 }))

        expect(blocked).not.toHaveBeenCalled()
    })

    it('calls sdk next for non-handled events', async () => {
        const { dispatch } = harness()

        const { next } = await dispatch({
            time: 1,
            self_id: 1,
            post_type: 'meta_event',
            meta_event_type: 'heartbeat',
        } as SnowLumaEvent)

        expect(next).toHaveBeenCalledTimes(1)
    })
})
