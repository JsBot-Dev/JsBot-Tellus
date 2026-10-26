import type {
    ActionParams,
    ActionResult,
    EventMiddleware,
    LoginInfo,
    OutgoingMessage,
    SnowLumaAction,
    SnowLumaEvent,
    SnowLumaEventContext,
} from '@snowluma/sdk'
import type { BotClient, BotSendOptions } from '../../src/core/client.js'

export interface FakeClientOptions {
    selfId?: number | undefined
    nickname?: string | undefined
    connectError?: Error | undefined
    closeError?: Error | undefined
}

export interface SentMessage {
    kind: 'group' | 'private' | 'group-forward' | 'private-forward'
    id: number
    message: OutgoingMessage
    options?: BotSendOptions | undefined
}

export class FakeClient implements BotClient {
    readonly selfId: number
    readonly nickname: string
    readonly middlewares: EventMiddleware[] = []
    readonly sent: SentMessage[] = []
    readonly calls: Array<{
        action: string
        params: unknown
    }> = []

    connected = false
    closed = false
    connectCalls = 0
    closeCalls = 0

    private readonly connectError: Error | undefined
    private readonly closeError: Error | undefined

    constructor(options: FakeClientOptions = {}) {
        this.selfId = options.selfId ?? 10000
        this.nickname = options.nickname ?? 'FakeBot'
        this.connectError = options.connectError
        this.closeError = options.closeError
    }

    use(middleware: EventMiddleware): () => void {
        this.middlewares.push(middleware)

        return () => {
            const index = this.middlewares.indexOf(middleware)

            if (index >= 0) {
                this.middlewares.splice(index, 1)
            }
        }
    }

    async connect(): Promise<void> {
        this.connectCalls += 1

        if (this.connectError) {
            throw this.connectError
        }

        this.connected = true
    }

    close(): void {
        this.closeCalls += 1
        this.closed = true

        if (this.closeError) {
            throw this.closeError
        }
    }

    async getLoginInfo(): Promise<LoginInfo> {
        return {
            user_id: this.selfId,
            nickname: this.nickname,
        }
    }

    async sendGroupMessage(
        groupId: number,
        message: OutgoingMessage,
        options?: BotSendOptions
    ): Promise<unknown> {
        this.sent.push({
            kind: 'group',
            id: groupId,
            message,
            options,
        })

        return { message_id: this.sent.length }
    }

    async sendPrivateMessage(
        userId: number,
        message: OutgoingMessage,
        options?: BotSendOptions
    ): Promise<unknown> {
        this.sent.push({
            kind: 'private',
            id: userId,
            message,
            options,
        })

        return { message_id: this.sent.length }
    }

    async sendGroupForwardMessage(
        groupId: number,
        message: OutgoingMessage
    ): Promise<unknown> {
        this.sent.push({
            kind: 'group-forward',
            id: groupId,
            message,
        })

        return { message_id: this.sent.length }
    }

    async sendPrivateForwardMessage(
        userId: number,
        message: OutgoingMessage
    ): Promise<unknown> {
        this.sent.push({
            kind: 'private-forward',
            id: userId,
            message,
        })

        return { message_id: this.sent.length }
    }

    async call<TAction extends SnowLumaAction>(
        action: TAction,
        params?: ActionParams<TAction>
    ): Promise<ActionResult<TAction>> {
        this.calls.push({ action, params })

        return undefined as unknown as ActionResult<TAction>
    }

    async dispatch(
        event: SnowLumaEvent,
        context: SnowLumaEventContext
    ): Promise<void> {
        let index = -1

        const next = async (): Promise<void> => {
            index += 1

            const middleware = this.middlewares[index]

            if (!middleware || context.stopped) return

            await middleware(event, context, next)
        }

        await next()
    }
}
