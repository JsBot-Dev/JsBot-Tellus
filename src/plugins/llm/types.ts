import type { TaskQueue } from '../../core/index.js'

export type LlmApi = 'chat-completions' | 'responses'

export interface LlmProviderConfig {
    base: string
    apikey: string
    model?: string | undefined
}

export interface LlmConfig {
    contextSize: number
    rateLimitMs: number
    api: LlmApi
    provider?: string | undefined
    model?: string | undefined
    persona?: string | undefined
    personas: Record<string, string>
    providers: Record<string, LlmProviderConfig>
    maxOutputTokens?: number | undefined
    temperature?: number | undefined
    splitThreshold: number
}

export type LlmRole = 'system' | 'user' | 'assistant'

export interface LlmMessage {
    role: LlmRole
    content: string
}

export interface LlmRuntime {
    chat(
        model: string,
        messages: LlmMessage[],
        options: { signal: AbortSignal }
    ): Promise<string>
    models(options: { signal: AbortSignal }): Promise<string[]>
}

export interface LlmRuntimeFactoryOptions {
    provider: string
    config: LlmProviderConfig
    api: LlmApi
    maxOutputTokens?: number | undefined
    temperature?: number | undefined
}

export type LlmRuntimeFactory = (
    options: LlmRuntimeFactoryOptions
) => LlmRuntime

export interface LlmState {
    runtimes: Map<string, LlmRuntime>
    lastRequest: Map<string, number>
    tasks: TaskQueue
}
