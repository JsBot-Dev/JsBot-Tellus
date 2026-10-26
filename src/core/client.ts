import {
    SnowLumaWebSocketClient,
    type ActionParams,
    type ActionResult,
    type EventMiddleware,
    type LoginInfo,
    type OutgoingMessage,
    type SnowLumaAction,
} from '@snowluma/sdk'

export interface BotSendOptions {
    autoEscape?: boolean
}

export interface BotClientOptions {
    url: string
    accessToken?: string
}

export interface BotClient {
    use(middleware: EventMiddleware): () => void
    connect(): Promise<void>
    close(): void
    getLoginInfo(): Promise<LoginInfo>

    sendGroupMessage(
        groupId: number,
        message: OutgoingMessage,
        options?: BotSendOptions
    ): Promise<unknown>

    sendPrivateMessage(
        userId: number,
        message: OutgoingMessage,
        options?: BotSendOptions
    ): Promise<unknown>

    sendGroupForwardMessage(
        groupId: number,
        message: OutgoingMessage
    ): Promise<unknown>

    sendPrivateForwardMessage(
        userId: number,
        message: OutgoingMessage
    ): Promise<unknown>

    call<TAction extends SnowLumaAction>(
        action: TAction,
        params?: ActionParams<TAction>
    ): Promise<ActionResult<TAction>>
}

export function createBotClient(options: BotClientOptions): BotClient {
    const client = new SnowLumaWebSocketClient({
        url: options.url,
        ...(options.accessToken ? { accessToken: options.accessToken } : {}),
        reconnect: true,
    })

    return {
        use: (middleware) => client.use(middleware),
        connect: () => client.connect(),
        close: () => client.close(),
        getLoginInfo: () => client.getLoginInfo(),

        sendGroupMessage: (groupId, message, sendOptions) =>
            client.sendGroupMessage(groupId, message, sendOptions),

        sendPrivateMessage: (userId, message, sendOptions) =>
            client.sendPrivateMessage(userId, message, sendOptions),

        sendGroupForwardMessage: (groupId, message) =>
            client.sendGroupForwardMessage(groupId, message),

        sendPrivateForwardMessage: (userId, message) =>
            client.sendPrivateForwardMessage(userId, message),

        async call(action, params) {
            const response = await client.request(action, params)

            if (response.status !== 'ok') {
                throw new Error(
                    response.wording ??
                        `action failed: ${action} (${response.retcode})`
                )
            }

            return response.data
        },
    }
}
