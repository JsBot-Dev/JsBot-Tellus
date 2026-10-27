import { z } from 'zod'

export const pluginGroupsSchema = z
    .object({
        allow: z.array(z.number().int().positive()).default([]),
        deny: z.array(z.number().int().positive()).default([]),
    })
    .strict()

export const pluginEnvelopeSchema = z
    .object({
        enabled: z.boolean().optional(),
        private: z.boolean().optional(),
        groups: pluginGroupsSchema.optional(),
    })
    .loose()
    .superRefine((value, context) => {
        if (
            value.groups &&
            value.groups.allow.length > 0 &&
            value.groups.deny.length > 0
        ) {
            context.addIssue({
                code: 'custom',
                message:
                    'groups.allow and groups.deny cannot both be non-empty',
                path: ['groups'],
            })
        }
    })

export const messageConfigSchema = z
    .object({
        charThreshold: z.number().int().positive().default(50),
        lineThreshold: z.number().int().positive().default(3),
    })
    .strict()
    .default({ charThreshold: 50, lineThreshold: 3 })

export const rolesConfigSchema = z
    .object({
        superadmin: z.array(z.number().int().positive()).default([]),
        admin: z.array(z.number().int().positive()).default([]),
    })
    .strict()
    .default({ superadmin: [], admin: [] })

export const installerConfigSchema = z
    .object({
        enabled: z.boolean().default(true),
        dir: z.string().min(1).optional(),
        registry: z.url().default('https://registry.npmjs.org/'),
        allowedPackages: z.array(z.string().min(1)).default([]),
        allowScripts: z.boolean().default(false),
        timeoutMs: z.number().int().positive().max(600_000).default(120_000),
    })
    .strict()

export const appConfigSchema = z
    .object({
        url: z.url({ protocol: /^wss?$/ }).default('ws://127.0.0.1:3001/'),
        accessToken: z.string().min(1).optional(),
        roles: rolesConfigSchema,
        message: messageConfigSchema,
        plugins: z.record(z.string(), pluginEnvelopeSchema).default({}),
        installer: installerConfigSchema.default({
            enabled: true,
            registry: 'https://registry.npmjs.org/',
            allowedPackages: [],
            allowScripts: false,
            timeoutMs: 120_000,
        }),
    })
    .strict()

export type PluginGroups = z.infer<typeof pluginGroupsSchema>
export type PluginEnvelope = z.infer<typeof pluginEnvelopeSchema>
export type MessageConfig = z.infer<typeof messageConfigSchema>
export type RolesConfig = z.infer<typeof rolesConfigSchema>
export type InstallerConfig = z.infer<typeof installerConfigSchema>
export type AppConfig = z.infer<typeof appConfigSchema>

export function formatConfigIssues(error: z.ZodError, prefix?: string): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.length > 0 ? issue.path.join('.') : '<root>'
            const fullPath = prefix ? `${prefix}.${path}` : path

            return `${fullPath}: ${issue.message}`
        })
        .join('\n')
}
