import z from 'zod'

const ConfigSchema = z
    .object({
        url: z.url({ protocol: /^wss?$/ }).default('ws://127.0.0.1:3001/'),
        accessToken: z.string().min(16),
        message: z
            .object({
                charThreshold: z.number().int().positive().default(50),
                lineThreshold: z.number().int().positive().default(3),
            })
            .strict()
            .default({ charThreshold: 50, lineThreshold: 3 }),
        role: z
            .object({
                superadmin: z.array(z.number().int().positive()).optional(),
                admin: z.array(z.number().int().positive()).optional(),
            })
            .strict()
            .default({}),
        llm: z
            .object({
                contextSize: z.number().int().positive().optional().default(50),
                providers: z
                    .record(
                        z.string(),
                        z.object({
                            base: z.httpUrl().optional(),
                            apikey: z.string().min(1),
                        })
                    )
                    .default({}),
            })
            .default({ contextSize: 30, providers: {} }),
        plugin: z
            .record(
                z.string(),
                z
                    .object({
                        status: z.enum(['Enable', 'Disable']),
                        list: z.array(z.number().int().positive()).optional(),
                    })
                    .strict()
            )
            .default({}),
    })
    .strict()
type Config = z.infer<typeof ConfigSchema>
export { ConfigSchema }
export type { Config }
