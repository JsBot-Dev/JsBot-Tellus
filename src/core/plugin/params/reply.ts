import { parseSegments, type OneBotMessageEvent } from '@snowluma/sdk'

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toMessageId(value: unknown): number | undefined {
    const raw = typeof value === 'string' ? value.trim() : value

    if (typeof raw !== 'number' && typeof raw !== 'string') {
        return undefined
    }

    const parsed =
        typeof raw === 'string'
            ? /^-?\d+$/.test(raw)
                ? Number(raw)
                : Number.NaN
            : raw

    return Number.isSafeInteger(parsed) && parsed !== 0 ? parsed : undefined
}

function replyIdIn(segments: readonly unknown[]): number | undefined {
    for (const segment of segments) {
        if (!isRecord(segment) || segment.type !== 'reply') continue

        const data = isRecord(segment.data) ? segment.data : undefined
        const id = toMessageId(data?.id)

        if (id !== undefined) return id
    }

    return undefined
}

export function quoteIdOf(
    event: OneBotMessageEvent | undefined
): number | undefined {
    if (!event) return undefined

    const message = event.message

    if (typeof message === 'string') {
        const id = replyIdIn(parseSegments(message))

        if (id !== undefined) return id
    } else if (Array.isArray(message)) {
        const id = replyIdIn(message)

        if (id !== undefined) return id
    } else if (isRecord(message)) {
        const id = replyIdIn([message])

        if (id !== undefined) return id
    }

    return replyIdIn(parseSegments(event.raw_message))
}
