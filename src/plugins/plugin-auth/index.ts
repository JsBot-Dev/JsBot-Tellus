import type { CommandHandler } from "@snowluma/sdk";
import { Command, JsBotBasePlugin, type PluginLevel } from "../../core";

export default class AuthPlugin extends JsBotBasePlugin {
    static override level: PluginLevel = 'Internal'
    @Command('role')
    role: CommandHandler = async (event, ctx, match) => {
        const { admin, superadmin } = this.bot.config.role
        if (superadmin?.includes(event.user_id)) {
            await ctx.reply('SuperAdmin')
        } else if (admin?.includes(event.user_id)) {
            await ctx.reply('Admin')
        } else {
            await ctx.reply('User')
        }
    }
}
