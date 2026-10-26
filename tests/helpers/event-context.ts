import type {
    OutgoingMessage,
    SnowLumaApiClient,
    SnowLumaEvent,
    SnowLumaEventContext,
} from '@snowluma/sdk'

export interface ReplyRecord {
    message: OutgoingMessage
    options: unknown
}

export class FakeEventContext implements SnowLumaEventContext {
    readonly event: SnowLumaEvent
    readonly client: SnowLumaApiClient
    readonly replies: ReplyRecord[] = []

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
        options?: Parameters<SnowLumaEventContext['reply']>[1]
    ): Promise<unknown> {
        this.replies.push({ message, options })
        return undefined
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
