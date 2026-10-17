import {
    isGroupMessageEvent,
    node,
    type OneBotMessageEvent,
    type OutgoingMessage,
    toCQString,
} from '@snowluma/sdk'
import { type CommandContext } from '../core/types/type'
import type { Config } from '../core/config/schema'

export default async function send_msg(
    ctx: CommandContext,
    message: OutgoingMessage,
    config: Config
) {
    const event = ctx.event as OneBotMessageEvent
    const cq = toCQString(message)

    if (
        !isTooLong(
            cq,
            config.message.charThreshold,
            config.message.lineThreshold
        )
    ) {
        return await ctx.reply(message)
    }
    const info = await ctx.client.getLoginInfo()
    const nickname = info.nickname || 'Bot'
    const forward = node(event.self_id, nickname, message)
    if (isGroupMessageEvent(event)) {
        return await ctx.client.sendGroupForwardMessage(event.group_id, forward)
    } else {
        return await ctx.client.sendPrivateForwardMessage(
            event.user_id,
            forward
        )
    }
}

function isTooLong(
    message: string,
    charThreshold: number,
    lineThreshold: number
) {
    return (
        message.length > charThreshold ||
        message.split('\n').length > lineThreshold
    )
}
