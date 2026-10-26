import { z } from 'zod'

export default {
    manifest: {
        id: 'hello',
        version: '1.0.0',
        description: 'External hello command example',
        priority: 10,
        defaultEnabled: true,
        configSchema: z
            .object({
                reply: z
                    .string()
                    .min(1)
                    .default('hello from an external plugin'),
            })
            .strict(),
    },

    setup(ctx) {
        ctx.commands.register(
            {
                name: 'hello',
                aliases: ['hey'],
                permission: 'User',
                description: 'External plugin demo',
            },
            async (_event, context) => {
                await context.send(ctx.config.reply)
            }
        )
    },
}
