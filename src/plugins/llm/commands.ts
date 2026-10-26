import type {
    EventContext,
    PluginContext,
    SessionState,
} from '../../core/index.js'
import type { OneBotMessageEvent } from '@snowluma/sdk'
import { runtimeFor } from './respond.js'
import type { LlmConfig, LlmRuntimeFactory, LlmState } from './types.js'

async function loadSession(
    plugin: PluginContext<LlmConfig>,
    sessionId: string
): Promise<SessionState> {
    const session = await plugin.sessions.get(sessionId)

    return (
        session ?? {
            sessionId,
            messages: [],
            updatedAt: Date.now(),
        }
    )
}

function sessionWith(
    session: SessionState,
    patch: {
        provider?: string
        model?: string
        persona?: string
        clearModel?: boolean
        clearPersona?: boolean
    }
): SessionState {
    const provider = patch.provider ?? session.provider
    const model = patch.clearModel ? undefined : (patch.model ?? session.model)
    const persona = patch.clearPersona
        ? undefined
        : (patch.persona ?? session.persona)

    return {
        sessionId: session.sessionId,
        ...(provider !== undefined ? { provider } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(persona !== undefined ? { persona } : {}),
        messages: session.messages,
        updatedAt: Date.now(),
    }
}

function currentProvider(
    plugin: PluginContext<LlmConfig>,
    session: SessionState
): string | undefined {
    return session.provider ?? plugin.config.provider
}

export function registerLlmCommands(
    plugin: PluginContext<LlmConfig>,
    state: LlmState,
    factory: LlmRuntimeFactory
): void {
    plugin.commands.register(
        {
            name: 'provider',
            permission: 'SuperAdmin',
            description: '查看或切换 LLM provider',
        },
        async (_event, context, match) => {
            const names = Object.keys(plugin.config.providers)
            const session = await loadSession(plugin, context.sessionId)
            const current = currentProvider(plugin, session)

            if (match.args.length === 0) {
                const lines = names.map(
                    (name) => `${name}${name === current ? '（当前）' : ''}`
                )

                await context.send(
                    names.length > 0
                        ? `可用 provider：\n${lines.join('\n')}`
                        : '当前没有可用的 provider'
                )
                return
            }

            if (match.args.length !== 1) {
                await context.send('用法：/provider <名称>')
                return
            }

            const requested = match.args[0] ?? ''

            if (!names.includes(requested)) {
                await context.send(`provider 不存在：${requested}`)
                return
            }

            const next = sessionWith(session, {
                provider: requested,
                clearModel: current !== requested,
            })

            await plugin.sessions.save(next)
            await context.send(`已切换 provider：${requested}`)
        }
    )

    plugin.commands.register(
        {
            name: 'model',
            permission: 'SuperAdmin',
            description: '查看或切换 LLM model',
        },
        async (_event, context, match) => {
            const session = await loadSession(plugin, context.sessionId)
            const provider = currentProvider(plugin, session)

            if (!provider) {
                await context.send('请先设置 provider')
                return
            }

            const runtime = runtimeFor(plugin, state, factory, provider)

            if (match.args.length === 0) {
                let models: string[]

                try {
                    models = await runtime.models({
                        signal: AbortSignal.timeout(15_000),
                    })
                } catch (error) {
                    plugin.logger.error('failed to list models', error)
                    await context.send('获取模型列表失败')
                    return
                }

                const current =
                    session.model ??
                    plugin.config.model ??
                    plugin.config.providers[provider]?.model
                const lines = models.map(
                    (model) => `${model}${model === current ? '（当前）' : ''}`
                )

                await context.send(
                    models.length > 0
                        ? `可用模型：\n${lines.join('\n')}`
                        : '当前 provider 没有可用模型'
                )
                return
            }

            if (match.args.length !== 1) {
                await context.send('用法：/model <模型 ID>')
                return
            }

            const requested = match.args[0] ?? ''

            await plugin.sessions.save(
                sessionWith(session, { model: requested })
            )
            await context.send(`已切换 model：${requested}`)
        }
    )

    plugin.commands.register(
        {
            name: 'persona',
            permission: 'SuperAdmin',
            description: '查看或切换 persona',
        },
        async (_event, context, match) => {
            const session = await loadSession(plugin, context.sessionId)
            const requested = match.rest.trim()

            if (!requested) {
                const names = Object.keys(plugin.config.personas)
                const current = session.persona ?? plugin.config.persona
                const lines = names.map(
                    (name) => `${name}${name === current ? '（当前）' : ''}`
                )

                await context.send(
                    names.length > 0
                        ? `可用 persona：\n${lines.join('\n')}`
                        : '当前没有可用的 persona'
                )
                return
            }

            if (requested === 'off' || requested === 'none') {
                await plugin.sessions.save(
                    sessionWith(session, { clearPersona: true })
                )
                await context.send('已清除 persona')
                return
            }

            await plugin.sessions.save(
                sessionWith(session, { persona: requested })
            )
            await context.send(`已切换 persona：${requested}`)
        }
    )
}
