import type {
    EventContext,
    PluginContext,
    SessionState,
} from '../../core/index.js'
import type { OneBotMessageEvent } from '@snowluma/sdk'
import { splitReply } from '../../core/messaging/render.js'
import {
    buildChatMessages,
    formatUserContent,
    resolvePersona,
    trimHistory,
} from './prompt.js'
import type {
    LlmConfig,
    LlmRuntime,
    LlmRuntimeFactory,
    LlmState,
} from './types.js'

export interface RespondInput {
    event: OneBotMessageEvent
    context: EventContext<OneBotMessageEvent>
}

const FAILURE_TEXT = '请求失败，请稍后再试'

export function runtimeFor(
    plugin: PluginContext<LlmConfig>,
    state: LlmState,
    factory: LlmRuntimeFactory,
    providerName: string
): LlmRuntime {
    const provider = plugin.config.providers[providerName]

    if (!provider) {
        throw new Error(`unknown provider: ${providerName}`)
    }

    const key = `${providerName}:${plugin.config.api}:${provider.base}`
    const existing = state.runtimes.get(key)

    if (existing) return existing

    const runtime = factory({
        provider: providerName,
        config: provider,
        api: plugin.config.api,
        ...(plugin.config.maxOutputTokens !== undefined
            ? {
                  maxOutputTokens: plugin.config.maxOutputTokens,
              }
            : {}),
        ...(plugin.config.temperature !== undefined
            ? { temperature: plugin.config.temperature }
            : {}),
    })

    state.runtimes.set(key, runtime)

    return runtime
}

async function safeSend(
    plugin: PluginContext<LlmConfig>,
    context: EventContext<OneBotMessageEvent>,
    text: string
): Promise<void> {
    try {
        await context.send(text, {
            quote: false,
            autoEscape: true,
        })
    } catch (error) {
        plugin.logger.error('failed to send llm message', error)
    }
}

export async function respond(
    plugin: PluginContext<LlmConfig>,
    state: LlmState,
    factory: LlmRuntimeFactory,
    input: RespondInput,
    signal: AbortSignal
): Promise<void> {
    const { event, context } = input
    const sessionId = context.sessionId
    const session = await plugin.sessions.get(sessionId)
    const providerName = session?.provider ?? plugin.config.provider

    if (!providerName) {
        await safeSend(plugin, context, 'LLM 尚未配置 provider')
        return
    }

    const provider = plugin.config.providers[providerName]

    if (!provider) {
        await safeSend(plugin, context, `LLM provider 不存在：${providerName}`)
        return
    }

    const model = session?.model ?? plugin.config.model ?? provider.model

    if (!model) {
        await safeSend(plugin, context, 'LLM 尚未配置 model')
        return
    }

    const persona = resolvePersona(plugin.config, session)
    const now = Date.now()
    const userMessage = {
        role: 'user' as const,
        content: formatUserContent(event, event.self_id),
        at: now,
    }
    const messages = trimHistory(
        [...(session?.messages ?? []), userMessage],
        plugin.config.contextSize
    )
    const base: SessionState = session ?? {
        sessionId,
        messages: [],
        updatedAt: now,
    }
    const pending: SessionState = {
        ...base,
        messages,
        updatedAt: now,
    }

    await plugin.sessions.save(pending)

    let text: string

    try {
        const runtime = runtimeFor(plugin, state, factory, providerName)

        text = await runtime.chat(model, buildChatMessages(persona, messages), {
            signal,
        })
    } catch (error) {
        if (!signal.aborted) {
            plugin.logger.error(
                `llm request failed: ${providerName}/${model}`,
                error
            )
            await safeSend(plugin, context, FAILURE_TEXT)
        }

        return
    }

    const trimmed = text.trim()

    if (!trimmed) {
        plugin.logger.warn('llm returned an empty response')
        return
    }

    const assistantMessage = {
        role: 'assistant' as const,
        content: trimmed,
        at: Date.now(),
    }

    await plugin.sessions.save({
        ...pending,
        messages: trimHistory(
            [...messages, assistantMessage],
            plugin.config.contextSize
        ),
        updatedAt: assistantMessage.at,
    })

    const parts = splitReply(trimmed, plugin.config.splitThreshold)

    for (const [index, part] of parts.entries()) {
        try {
            await context.send(part, {
                quote: index === 0,
                autoEscape: true,
            })
        } catch (error) {
            plugin.logger.error('failed to send llm reply part', error)
        }
    }
}
