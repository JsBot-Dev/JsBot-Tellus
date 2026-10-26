import OpenAI from 'openai'
import type { ResponseInput } from 'openai/resources/responses/responses.js'
import type {
    LlmRuntime,
    LlmRuntimeFactoryOptions,
    LlmMessage,
} from './types.js'

export function createOpenAiRuntime(
    options: LlmRuntimeFactoryOptions
): LlmRuntime {
    const client = new OpenAI({
        baseURL: options.config.base,
        apiKey: options.config.apikey,
    })

    return {
        async chat(model, messages, { signal }) {
            if (options.api === 'responses') {
                const input: ResponseInput = messages.map((message) => ({
                    role: message.role,
                    content: message.content,
                }))

                const response = await client.responses.create(
                    {
                        model,
                        input,
                        ...(options.maxOutputTokens !== undefined
                            ? {
                                  max_output_tokens: options.maxOutputTokens,
                              }
                            : {}),
                        ...(options.temperature !== undefined
                            ? {
                                  temperature: options.temperature,
                              }
                            : {}),
                    },
                    { signal }
                )

                return response.output_text
            }

            const response = await client.chat.completions.create(
                {
                    model,
                    messages: messages.map((message) => ({
                        role: message.role,
                        content: message.content,
                    })),
                    ...(options.maxOutputTokens !== undefined
                        ? {
                              max_tokens: options.maxOutputTokens,
                          }
                        : {}),
                    ...(options.temperature !== undefined
                        ? {
                              temperature: options.temperature,
                          }
                        : {}),
                },
                { signal }
            )

            return response.choices[0]?.message.content ?? ''
        },

        async models({ signal }) {
            const list = await client.models.list({ signal })

            return list.data.map((model) => model.id)
        },
    }
}

export function buildRuntime(
    options: LlmRuntimeFactoryOptions,
    create: (options: LlmRuntimeFactoryOptions) => LlmRuntime
): LlmRuntime {
    return create(options)
}

export function messagesOf(
    system: string | undefined,
    history: LlmMessage[]
): LlmMessage[] {
    return [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        ...history,
    ]
}
