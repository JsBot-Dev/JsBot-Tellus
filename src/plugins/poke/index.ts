import { z } from 'zod'
import { definePlugin } from '../../core/index.js'

export const pokePlugin = definePlugin({
    manifest: {
        id: 'poke',
        version: '2.0.0',
        description: 'Reply when the bot is poked',
        priority: 100,
        defaultEnabled: true,
        configSchema: z
            .object({
                cooldownMs: z.number().int().nonnegative().default(3000),
                reply: z.string().min(1).default('你戳我干嘛'),
            })
            .strict(),
    },

    setup(ctx) {
        ctx.events.onNotice(
            {
                noticeType: 'notify',
                subType: 'poke',
            },
            async (event, context) => {
                const notice = event as {
                    target_id?: unknown
                }

                if (notice.target_id !== event.self_id) return

                const key = `poke:${context.sessionId}:${event.user_id}`
                const now = Date.now()
                const last = await ctx.kv.get<number>(key)

                if (last !== undefined && now - last < ctx.config.cooldownMs) {
                    return
                }

                await ctx.kv.set(key, now)
                await context.send(ctx.config.reply)
            }
        )
    },
})
