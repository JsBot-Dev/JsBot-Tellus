import type {
    OutgoingMessage,
    SendMessageResult,
    SnowLumaApiClient,
    SnowLumaEvent,
    SnowLumaEventContextWithQuote,
} from '@snowluma/sdk'

export interface ReplyRecord {
    message: OutgoingMessage
    options: unknown
}

export class FakeEventContext implements SnowLumaEventContextWithQuote {
    readonly event: SnowLumaEvent
    readonly client: SnowLumaApiClient
    readonly replies: ReplyRecord[] = []
    readonly quotes: ReplyRecord[] = []

    private stoppedValue = false

    constructor(event: SnowLumaEvent) {
        this.event = event
        this.client = null as unknown as SnowLumaApiClient
    }

    get stopped(): boolean {
        return this.stoppedValue
    }

    stopPropagation(): void {
        this.stoppedValue = true
    }

    async reply(
        message: OutgoingMessage,
        options?: Parameters<SnowLumaEventContextWithQuote['reply']>[1]
    ): Promise<unknown> {
        this.replies.push({ message, options })
        return undefined
    }

    async quote(
        message: OutgoingMessage,
        options?: Parameters<SnowLumaEventContextWithQuote['quote']>[1]
    ): Promise<SendMessageResult> {
        const record = { message, options }

        this.quotes.push(record)
        this.replies.push(record)
        return { message_id: this.quotes.length }
    }

    async approve(..._args: unknown[]): Promise<unknown> {
        return undefined
    }

    async reject(..._args: unknown[]): Promise<unknown> {
        return undefined
    }

    async quickOperation(..._args: unknown[]): Promise<unknown> {
        return undefined
    }
}
