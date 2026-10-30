import type { SnowLumaEvent } from '@snowluma/sdk'

export type FeedEventType = 'message' | 'notice' | 'request' | 'meta' | 'other'

export interface FeedEvent {
    id: number
    time: number
    type: FeedEventType
    summary: string
    event: SnowLumaEvent
}

export interface FeedFilter {
    type?: FeedEventType | undefined
    limit?: number | undefined
}

function recordOf(event: SnowLumaEvent): Record<string, unknown> {
    return event as unknown as Record<string, unknown>
}

function eventTypeOf(event: SnowLumaEvent): FeedEventType {
    const postType = recordOf(event).post_type

    switch (postType) {
        case 'message':
            return 'message'
        case 'notice':
            return 'notice'
        case 'request':
            return 'request'
        case 'meta_event':
            return 'meta'
        default:
            return 'other'
    }
}

function readString(
    value: Record<string, unknown>,
    key: string
): string | undefined {
    const item = value[key]

    return typeof item === 'string' ? item : undefined
}

function readNumber(
    value: Record<string, unknown>,
    key: string
): number | undefined {
    const item = value[key]

    return typeof item === 'number' ? item : undefined
}

function truncate(value: string, max = 200): string {
    return value.length > max ? `${value.slice(0, max)}…` : value
}

function summarize(event: SnowLumaEvent): string {
    const value = recordOf(event)
    const type = eventTypeOf(event)

    if (type === 'message') {
        const sender = value.sender

        if (typeof sender === 'object' && sender !== null) {
            const senderRecord = sender as Record<string, unknown>
            const name =
                readString(senderRecord, 'card') ??
                readString(senderRecord, 'nickname') ??
                String(readNumber(value, 'user_id') ?? 'unknown')
            const raw = readString(value, 'raw_message') ?? ''

            return truncate(`${name}: ${raw}`)
        }

        return truncate(readString(value, 'raw_message') ?? 'message')
    }

    if (type === 'notice') {
        return truncate(
            `notice ${readString(value, 'notice_type') ?? 'unknown'}`
        )
    }

    if (type === 'request') {
        return truncate(
            `request ${readString(value, 'request_type') ?? 'unknown'}`
        )
    }

    if (type === 'meta') {
        return truncate(
            `meta ${readString(value, 'meta_event_type') ?? 'unknown'}`
        )
    }

    return truncate(`event ${String(value.post_type ?? 'unknown')}`)
}

export class EventFeed {
    private readonly entries: FeedEvent[] = []
    private readonly listeners = new Set<(entry: FeedEvent) => void>()
    private nextId = 1

    constructor(private readonly capacity = 200) {}

    get size(): number {
        return this.entries.length
    }

    add(event: SnowLumaEvent): void {
        const entry: FeedEvent = {
            id: this.nextId,
            time: Date.now(),
            type: eventTypeOf(event),
            summary: summarize(event),
            event,
        }

        this.nextId += 1
        this.entries.push(entry)

        if (this.entries.length > this.capacity) {
            this.entries.splice(0, this.entries.length - this.capacity)
        }

        for (const listener of this.listeners) {
            try {
                listener(entry)
            } catch {
                // Event consumers must never break dispatch.
            }
        }
    }

    list(filter: FeedFilter = {}): FeedEvent[] {
        const matched = this.entries.filter(
            (entry) => filter.type === undefined || entry.type === filter.type
        )
        const limit = filter.limit

        if (limit === undefined || limit < 0 || limit >= matched.length) {
            return matched
        }

        return matched.slice(-limit)
    }

    clear(): void {
        this.entries.length = 0
    }

    subscribe(listener: (entry: FeedEvent) => void): () => void {
        this.listeners.add(listener)

        return () => {
            this.listeners.delete(listener)
        }
    }
}
