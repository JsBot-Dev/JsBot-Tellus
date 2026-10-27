import {
    isMessageEvent,
    node,
    type LoginInfo,
    type OutgoingMessage,
    type SnowLumaEvent,
    type SnowLumaEventContextWithQuote,
} from '@snowluma/sdk'
import type { BotClient, BotSendOptions } from '../client.js'
import type { MessageConfig } from '../config/schema.js'
import type { Logger } from '../logging/logger.js'
import { isTooLong } from './render.js'

export interface SendOptions extends BotSendOptions {
    quote?: boolean
}

export interface MessageSender {
    send(
        event: SnowLumaEvent,
        sdkContext: SnowLumaEventContextWithQuote,
        message: OutgoingMessage,
        options?: SendOptions
    ): Promise<unknown>

    sendToSession(
        sessionId: string,
        message: OutgoingMessage,
        options?: SendOptions
    ): Promise<unknown>
}

export interface MessageSenderOptions {
    client: BotClient
    message: MessageConfig
    logger: Logger
}

type Target = { kind: 'group'; id: number } | { kind: 'private'; id: number }

function readNumber(
    event: SnowLumaEvent,
    key: 'group_id' | 'user_id'
): number | undefined {
    const value = (event as Record<string, unknown>)[key]

    return typeof value === 'number' ? value : undefined
}

function targetOf(event: SnowLumaEvent): Target {
    if (isMessageEvent(event)) {
        return event.message_type === 'group'
            ? { kind: 'group', id: event.group_id }
            : { kind: 'private', id: event.user_id }
    }

    const groupId = readNumber(event, 'group_id')

    if (groupId !== undefined) {
        return { kind: 'group', id: groupId }
    }

    const userId = readNumber(event, 'user_id')

    if (userId !== undefined) {
        return { kind: 'private', id: userId }
    }

    throw new Error(`cannot determine target for ${event.post_type}`)
}

function parseSessionId(sessionId: string): Target {
    const separator = sessionId.indexOf(':')

    if (separator <= 0) {
        throw new Error(`invalid session id: ${sessionId}`)
    }

    const kind = sessionId.slice(0, separator)
    const rawId = sessionId.slice(separator + 1)

    if (!/^[1-9]\d*$/.test(rawId)) {
        throw new Error(`invalid session id: ${sessionId}`)
    }

    const id = Number(rawId)

    if (!Number.isSafeInteger(id)) {
        throw new Error(`invalid session id: ${sessionId}`)
    }

    if (kind === 'group') {
        return { kind: 'group', id }
    }

    if (kind === 'private') {
        return { kind: 'private', id }
    }

    throw new Error(`unknown session kind: ${kind}`)
}

function sdkOptions(options?: SendOptions): BotSendOptions | undefined {
    if (!options || options.autoEscape === undefined) {
        return undefined
    }

    return { autoEscape: options.autoEscape }
}

export function createMessageSender(
    options: MessageSenderOptions
): MessageSender {
    const { client, message: messageConfig, logger } = options

    async function sendDirect(
        target: Target,
        message: OutgoingMessage,
        sendOptions?: BotSendOptions
    ): Promise<unknown> {
        return target.kind === 'group'
            ? client.sendGroupMessage(target.id, message, sendOptions)
            : client.sendPrivateMessage(target.id, message, sendOptions)
    }

    async function sendForward(
        target: Target,
        message: OutgoingMessage,
        loginInfo: LoginInfo
    ): Promise<unknown> {
        const forward = node(
            loginInfo.user_id,
            loginInfo.nickname || 'Bot',
            message
        )

        return target.kind === 'group'
            ? client.sendGroupForwardMessage(target.id, forward)
            : client.sendPrivateForwardMessage(target.id, forward)
    }

    return {
        async send(event, sdkContext, message, sendOptions) {
            try {
                const target = targetOf(event)

                if (!isTooLong(message, messageConfig)) {
                    if (isMessageEvent(event) && sendOptions?.quote !== false) {
                        return await sdkContext.quote(
                            message,
                            sdkOptions(sendOptions)
                        )
                    }

                    return await sendDirect(
                        target,
                        message,
                        sdkOptions(sendOptions)
                    )
                }

                const loginInfo = await client.getLoginInfo()

                return await sendForward(target, message, loginInfo)
            } catch (error) {
                logger.error('failed to send message', error)
                throw error
            }
        },

        async sendToSession(sessionId, message, sendOptions) {
            try {
                const target = parseSessionId(sessionId)

                if (!isTooLong(message, messageConfig)) {
                    return await sendDirect(
                        target,
                        message,
                        sdkOptions(sendOptions)
                    )
                }

                const loginInfo = await client.getLoginInfo()

                return await sendForward(target, message, loginInfo)
            } catch (error) {
                logger.error(`failed to send to session ${sessionId}`, error)
                throw error
            }
        },
    }
}
