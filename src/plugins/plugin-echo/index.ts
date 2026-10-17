import {
    at,
    image,
    text,
    type CommandHandler,
    type EventHandler,
    type OneBotNoticeEvent,
} from '@snowluma/sdk'
import { Command } from '../../core'
import { JsBotBasePlugin } from '../../core/plugin/base'
import type { PluginLevel } from '../../core/types/type'
import { OnNotice } from '../../core/decorator/decorator'

export default class EchoPlugin extends JsBotBasePlugin {
    static override level: PluginLevel = 'Integrated'
    @Command('utter', { permission: 'Admin' })
    utter: CommandHandler = async (event, ctx, match) => {
        await this.bot.send_msg(ctx, match.rest)
    }
    @Command('utter.raw', { permission: 'Admin' })
    utter_raw: CommandHandler = async (event, ctx, match) => {
        await this.bot.send_msg(ctx, text(match.rest))
    }
}
