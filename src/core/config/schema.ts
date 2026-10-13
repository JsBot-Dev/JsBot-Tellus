import z from 'zod';
const ConfigSchema = z.object({
    url: z.string().default('ws://127.0.0.1:3001/'),
    accessToken: z.string().min(16),
    role: z.object({
        superadmin: z.array(z.number()).optional(),
        admin: z.array(z.number()).optional()
    })
})
type Config = z.infer<typeof ConfigSchema>
export { ConfigSchema };
export type { Config };
