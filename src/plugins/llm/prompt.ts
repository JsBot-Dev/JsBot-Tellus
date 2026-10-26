import { toCQString } from '@snowluma/sdk'
import type { OneBotMessageEvent, OutgoingMessage } from '@snowluma/sdk'
import type { SessionMessage, SessionState } from '../../core/index.js'
import type { LlmConfig, LlmMessage } from './types.js'

export function mentionsSelf(
    event: OneBotMessageEvent,
    selfId: number
): boolean {
    if (Array.isArray(event.message)) {
        const found = event.message.some((item) => {
            if (typeof item !== 'object' || item === null) {
                return false
            }

            const segment = item as {
                type?: unknown
                data?: { qq?: unknown }
            }

            if (segment.type !== 'at') return false

            return String(segment.data?.qq) === String(selfId)
        })

        if (found) return true
    }

    return new RegExp(`\\[CQ:at,qq=${selfId}(?:,[^\\]]*)?\\]`).test(
        event.raw_message
    )
}

export function stripSelfMention(text: string, selfId: number): string {
    return text
        .replace(new RegExp(`\\[CQ:at,qq=${selfId}(?:,[^\\]]*)?\\]`, 'g'), '')
        .trim()
}

export function formatUserContent(
    event: OneBotMessageEvent,
    selfId: number
): string {
    const text =
        stripSelfMention(
            toCQString(event.message as OutgoingMessage),
            selfId
        ) || stripSelfMention(event.raw_message, selfId)
    const nickname = event.sender.nickname || String(event.user_id)

    return `${nickname}(${event.user_id}): ${text || '[空消息]'}`
}

export function resolvePersona(
    config: LlmConfig,
    state: SessionState | null
): string | undefined {
    const value = state?.persona ?? config.persona

    if (!value) return undefined

    return config.personas[value] ?? value
}

export function trimHistory(
    messages: SessionMessage[],
    contextSize: number
): SessionMessage[] {
    return messages.slice(-(contextSize * 2))
}

export function buildChatMessages(
    persona: string | undefined,
    history: SessionMessage[]
): LlmMessage[] {
    return [
        ...(persona ? [{ role: 'system' as const, content: persona }] : []),
        ...history.map((message) => ({
            role: message.role,
            content: message.content,
        })),
    ]
}
