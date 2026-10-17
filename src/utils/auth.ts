import { chain, reply, type OneBotMessageEvent } from '@snowluma/sdk'
import type { CommandContext } from '../core/types/type'
import type { Config } from '../core/config/schema'
import type { PermissionType } from '../core'
import type { JsBot } from '../core/bot'

function refuse(bot: JsBot, ctx: CommandContext, event: OneBotMessageEvent) {
    return bot.send_msg(
        ctx,
        chain().reply(event.message_id).text('权限不足').face(79)
    )
}

function getRole(config: Config, user: number): PermissionType {
    const { admin, superadmin } = config.role
    if (superadmin?.includes(user)) return 'SuperAdmin'
    if (admin?.includes(user)) return 'Admin'
    return 'User'
}
export { refuse, getRole }
