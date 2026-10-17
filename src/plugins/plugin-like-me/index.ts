import type { CommandHandler } from "@snowluma/sdk";
import { Command, JsBotBasePlugin } from "../../core";

export default class LikeMePlugin extends JsBotBasePlugin {
    @Command('赞我')
    send_like: CommandHandler = async (event, ctx) => {
        try {
            const res = await this.bot.client.rawResponse('send_like', { user_id: event.user_id, times: 10 })
            if (res.status === 'ok')
                await this.bot.send_msg(ctx, '给你点了10个赞')
            else
                await this.bot.send_msg(ctx, `点赞失败：${res.wording}`)
        } catch (e) {
            await this.bot.send_msg(ctx, `点赞失败：${e}`)
        }
    }
}
