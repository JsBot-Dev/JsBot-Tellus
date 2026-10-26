import { describe, expect, it, vi } from 'vitest'
import { createLlmPlugin } from '../../src/plugins/llm/index.js'
import { corePlugin } from '../../src/plugins/core/index.js'
import type { LlmRuntimeFactory } from '../../src/plugins/llm/types.js'
import { groupMessage, privateMessage } from '../helpers/events.js'
import { createFakeLlm } from '../helpers/fake-llm.js'
import { createTestApp, type TestApp } from '../helpers/test-app.js'
import type { FakeEventContext } from '../helpers/event-context.js'

const GROUP_ID = 123456

function config(
    overrides: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        enabled: true,
        provider: 'test',
        rateLimitMs: 0,
        contextSize: 5,
        splitThreshold: 300,
        providers: {
            test: {
                base: 'https://example.com/v1',
                apikey: 'test-key',
                model: 'test-model',
            },
        },
        ...overrides,
    }
}

async function setup(
    factory: LlmRuntimeFactory,
    overrides: Record<string, unknown> = {},
    options: {
        drainTimeoutMs?: number
        roles?: {
            superadmin: number[]
            admin: number[]
        }
    } = {}
): Promise<TestApp> {
    return await createTestApp({
        plugins: [corePlugin, createLlmPlugin(factory)],
        pluginConfigs: {
            llm: config(overrides),
        },
        ...(options.roles !== undefined ? { roles: options.roles } : {}),
        ...(options.drainTimeoutMs !== undefined
            ? { drainTimeoutMs: options.drainTimeoutMs }
            : {}),
    })
}

function mention(overrides: Record<string, unknown> = {}) {
    return groupMessage({
        group_id: GROUP_ID,
        raw_message: '[CQ:at,qq=10000] 你好',
        ...overrides,
    })
}

function texts(app: TestApp, context: FakeEventContext): string[] {
    return [
        ...context.replies.map((reply) => String(reply.message)),
        ...app.client.sent.map((message) => String(message.message)),
    ]
}

describe('llm plugin', () => {
    it('is disabled by default', async () => {
        const fake = createFakeLlm()
        const app = await createTestApp({
            plugins: [corePlugin, createLlmPlugin(fake.factory)],
            pluginConfigs: {},
        })

        const result = await app.dispatch(mention())

        await app.drain()

        expect(fake.calls).toHaveLength(0)
        expect(result.replies).toEqual([])
        expect(app.client.sent).toEqual([])

        await app.stop()
    })

    it('triggers on a group mention', async () => {
        const fake = createFakeLlm({ reply: '你好呀' })
        const app = await setup(fake.factory)

        const result = await app.dispatch(mention())

        await app.drain()

        expect(fake.calls).toHaveLength(1)
        expect(fake.calls[0]?.provider).toBe('test')
        expect(texts(app, result)).toEqual(['你好呀'])

        await app.stop()
    })

    it('does not trigger without a mention in groups', async () => {
        const fake = createFakeLlm()
        const app = await setup(fake.factory)

        await app.dispatch(
            groupMessage({
                group_id: GROUP_ID,
                raw_message: '你好',
            })
        )

        await app.drain()

        expect(fake.calls).toHaveLength(0)

        await app.stop()
    })

    it('triggers in private chats when enabled', async () => {
        const fake = createFakeLlm()
        const app = await setup(fake.factory)

        await app.dispatch(privateMessage({ raw_message: 'hi' }))

        await app.drain()

        expect(fake.calls).toHaveLength(1)

        await app.stop()
    })

    it('honours the private switch', async () => {
        const fake = createFakeLlm()
        const app = await setup(fake.factory, {
            private: false,
        })

        await app.dispatch(privateMessage({ raw_message: 'hi' }))

        await app.drain()

        expect(fake.calls).toHaveLength(0)

        await app.stop()
    })

    it('ignores its own messages', async () => {
        const fake = createFakeLlm()
        const app = await setup(fake.factory)

        await app.dispatch(
            groupMessage({
                group_id: GROUP_ID,
                user_id: 10000,
                raw_message: '[CQ:at,qq=10000] self',
            })
        )

        await app.drain()

        expect(fake.calls).toHaveLength(0)

        await app.stop()
    })

    it('keeps sessions isolated', async () => {
        const fake = createFakeLlm({
            reply: (call) => call.messages.at(-1)?.content ?? '',
        })
        const app = await setup(fake.factory)

        await app.dispatch(
            mention({
                group_id: 1,
                raw_message: '[CQ:at,qq=10000] 群一',
            })
        )
        await app.drain()
        await app.dispatch(privateMessage({ raw_message: '私聊' }))
        await app.drain()

        expect(fake.calls).toHaveLength(2)
        expect(fake.calls[1]?.messages).not.toEqual(fake.calls[0]?.messages)

        await app.stop()
    })

    it('includes assistant messages in later turns', async () => {
        const fake = createFakeLlm({ reply: '第一轮回答' })
        const app = await setup(fake.factory)

        await app.dispatch(mention())
        await app.drain()
        await app.dispatch(mention())
        await app.drain()

        const second = fake.calls[1]?.messages ?? []

        expect(
            second.some(
                (message) =>
                    message.role === 'assistant' &&
                    message.content === '第一轮回答'
            )
        ).toBe(true)
        expect(
            second.some(
                (message) =>
                    message.role === 'user' && message.content.includes('你好')
            )
        ).toBe(true)

        await app.stop()
    })

    it('applies the rate limit', async () => {
        const fake = createFakeLlm()
        const app = await setup(fake.factory, {
            rateLimitMs: 60_000,
        })

        await app.dispatch(mention())
        await app.drain()
        await app.dispatch(mention())
        await app.drain()

        expect(fake.calls).toHaveLength(1)

        await app.stop()
    })

    it('sends only a generic failure message', async () => {
        const fake = createFakeLlm({
            error: new Error('secret upstream error'),
        })
        const app = await setup(fake.factory)

        const result = await app.dispatch(mention())

        await app.drain()

        const output = texts(app, result).join('\n')

        expect(output).toContain('请求失败')
        expect(output).not.toContain('secret upstream error')
        expect(fake.calls).toHaveLength(1)

        await app.stop()
    })

    it('splits replies without losing content', async () => {
        const fake = createFakeLlm({
            reply: '第一句。第二句。第三句。',
        })
        const app = await setup(fake.factory, {
            splitThreshold: 6,
        })

        const result = await app.dispatch(mention())

        await app.drain()

        const output = texts(app, result)

        expect(output.length).toBeGreaterThan(1)
        expect(output.join('')).toBe('第一句。第二句。第三句。')

        await app.stop()
    })

    it('uses session provider, model and persona overrides', async () => {
        const fake = createFakeLlm()
        const app = await setup(
            fake.factory,
            {
                model: undefined,
                persona: 'default persona',
                personas: { helper: '你是助手' },
                providers: {
                    test: {
                        base: 'https://example.com/v1',
                        apikey: 'a',
                        model: 'model-test',
                    },
                    other: {
                        base: 'https://example.com/v2',
                        apikey: 'b',
                        model: 'model-other',
                    },
                },
            },
            {
                roles: {
                    superadmin: [10000],
                    admin: [],
                },
            }
        )

        await app.dispatch(mention())
        await app.drain()

        expect(fake.calls[0]?.model).toBe('model-test')
        expect(fake.calls[0]?.messages[0]).toEqual({
            role: 'system',
            content: 'default persona',
        })

        await app.dispatch(
            groupMessage({
                raw_message: '/model model-session',
                user_id: 10000,
            })
        )
        await app.dispatch(mention())
        await app.drain()

        expect(fake.calls[1]?.model).toBe('model-session')

        await app.dispatch(
            groupMessage({
                raw_message: '/provider other',
                user_id: 10000,
            })
        )
        await app.dispatch(mention())
        await app.drain()

        expect(fake.calls[2]?.provider).toBe('other')
        expect(fake.calls[2]?.model).toBe('model-other')

        await app.dispatch(
            groupMessage({
                raw_message: '/persona helper',
                user_id: 10000,
            })
        )
        await app.dispatch(mention())
        await app.drain()

        expect(fake.calls[3]?.messages[0]).toEqual({
            role: 'system',
            content: '你是助手',
        })

        await app.dispatch(
            groupMessage({
                raw_message: '/persona custom prompt',
                user_id: 10000,
            })
        )
        await app.dispatch(mention())
        await app.drain()

        expect(fake.calls[4]?.messages[0]).toEqual({
            role: 'system',
            content: 'custom prompt',
        })

        await app.stop()
    })

    it('lists providers and models', async () => {
        const fake = createFakeLlm({
            models: ['model-a', 'model-b'],
        })
        const app = await setup(
            fake.factory,
            {},
            {
                roles: {
                    superadmin: [10000],
                    admin: [],
                },
            }
        )

        const providers = await app.dispatch(
            groupMessage({
                raw_message: '/provider',
                user_id: 10000,
            })
        )
        const models = await app.dispatch(
            groupMessage({
                raw_message: '/model',
                user_id: 10000,
            })
        )

        expect(texts(app, providers).join('')).toContain('test（当前）')
        expect(texts(app, models).join('')).toContain('model-a')
        expect(fake.modelCalls).toEqual(['test'])

        await app.stop()
    })

    it('reports a missing provider without calling the runtime', async () => {
        const fake = createFakeLlm()
        const app = await setup(fake.factory, {
            provider: 'missing',
        })

        const result = await app.dispatch(mention())

        await app.drain()

        expect(fake.calls).toHaveLength(0)
        expect(texts(app, result).join('')).toContain('provider 不存在')

        await app.stop()
    })

    it('cancels the running request on stop', async () => {
        const fake = createFakeLlm({ waitForAbort: true })
        const app = await setup(
            fake.factory,
            {},
            {
                drainTimeoutMs: 20,
            }
        )

        const result = await app.dispatch(mention())

        await vi.waitFor(() => {
            expect(fake.calls).toHaveLength(1)
        })

        await app.stop()

        expect(fake.calls[0]?.signal.aborted).toBe(true)
        expect(result.replies).toEqual([])
    })
})
