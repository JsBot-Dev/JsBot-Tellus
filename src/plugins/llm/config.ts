import { z } from 'zod'
import type { LlmConfig } from './types.js'

const providerSchema = z
    .object({
        base: z.string().url(),
        apikey: z.string().min(1),
        model: z.string().min(1).optional(),
    })
    .strict()

export const llmConfigSchema = z
    .object({
        contextSize: z.number().int().positive().default(50),
        rateLimitMs: z.number().int().nonnegative().default(3000),
        api: z
            .enum(['chat-completions', 'responses'])
            .default('chat-completions'),
        provider: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
        persona: z.string().min(1).optional(),
        personas: z.record(z.string(), z.string()).default({}),
        providers: z.record(z.string(), providerSchema).default({}),
        maxOutputTokens: z.number().int().positive().optional(),
        temperature: z.number().min(0).max(2).optional(),
        splitThreshold: z.number().int().positive().default(300),
    })
    .strict()

export type LlmConfigInput = z.input<typeof llmConfigSchema>

export function parseLlmConfig(value: unknown): LlmConfig {
    return llmConfigSchema.parse(value)
}
