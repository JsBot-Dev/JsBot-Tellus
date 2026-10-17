import z from 'zod';
const ProviderSchema = z.object({
    base: z.string().optional(),
    apikey: z.string()
})
const ConfigSchema = z.object({
    url: z.string().default('ws://127.0.0.1:3001/'),
    accessToken: z.string().min(16),
    role: z.object({
        superadmin: z.array(z.number()).optional(),
        admin: z.array(z.number()).optional()
    }),
    llm: z.preprocess(
        value => value ?? { providers: {} },
        z.union([
            z.object({ providers: z.record(z.string(), ProviderSchema) }),
            z.object({ base: z.string().optional(), apikey: z.string() }).transform(({ base, apikey }) => ({
                providers: { default: { base, apikey } }
            }))
        ])
    ),
    plugin:z.record(
        z.string(),
        z.object({
            status:z.enum(['Enable','Disable']),
            list:z.array(z.number()).optional()
        })
    )
})
type Config = z.infer<typeof ConfigSchema>
export { ConfigSchema };
export type { Config };
