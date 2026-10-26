import type {
    ActionParams,
    ActionResult,
    LoginInfo,
    OutgoingMessage,
    SnowLumaAction,
} from '@snowluma/sdk'
import type { BotClient } from './client.js'
import type { MessageSender, SendOptions } from './messaging/sender.js'

export interface BotApi {
    getLoginInfo(): Promise<LoginInfo>
    send(
        sessionId: string,
        message: OutgoingMessage,
        options?: SendOptions
    ): Promise<unknown>
    call<TAction extends SnowLumaAction>(
        action: TAction,
        params?: ActionParams<TAction>
    ): Promise<ActionResult<TAction>>
}

export function createBotApi(client: BotClient, sender: MessageSender): BotApi {
    return {
        getLoginInfo: () => client.getLoginInfo(),
        send: (sessionId, message, options) =>
            sender.sendToSession(sessionId, message, options),
        call: (action, params) => client.call(action, params),
    }
}
