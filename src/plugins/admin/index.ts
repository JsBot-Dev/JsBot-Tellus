import { z } from 'zod'
import { definePlugin } from '../../core/index.js'

export const adminPlugin = definePlugin({
    manifest: {
        id: 'admin',
        version: '2.0.0',
        description: 'Administrative message commands',
        priority: 900,
        defaultEnabled: true,
        configSchema: z.object({}).strict(),
    },

    setup(ctx) {
        ctx.commands.register(
            {
                name: 'utter',
                permission: 'Admin',
                description: '向当前会话发送文本',
            },
            async (_event, context, match) => {
                if (!match.rest) {
                    await context.send('用法：/utter <文本>')
                    return
                }

                await context.send(match.rest, {
                    quote: false,
                })
            }
        )

        ctx.commands.register(
            {
                name: 'utter.raw',
                permission: 'SuperAdmin',
                description: '发送原始 CQ 消息',
            },
            async (_event, context, match) => {
                if (!match.rest) {
                    await context.send('用法：/utter.raw <CQ 消息>')
                    return
                }

                await context.send(match.rest, {
                    quote: false,
                })
            }
        )
    },
})
