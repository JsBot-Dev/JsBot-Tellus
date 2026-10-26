import type {
    LlmMessage,
    LlmRuntimeFactory,
} from '../../src/plugins/llm/types.js'

export interface LlmCall {
    provider: string
    api: string
    model: string
    messages: LlmMessage[]
    signal: AbortSignal
}

export interface FakeLlmOptions {
    reply?: string | ((call: LlmCall) => string | Promise<string>)
    models?: string[]
    error?: Error
    modelsError?: Error
    waitForAbort?: boolean
}

export function createFakeLlm(options: FakeLlmOptions = {}) {
    const calls: LlmCall[] = []
    const modelCalls: string[] = []

    const factory: LlmRuntimeFactory = (runtime) => ({
        async chat(model, messages, { signal }) {
            const call: LlmCall = {
                provider: runtime.provider,
                api: runtime.api,
                model,
                messages,
                signal,
            }

            calls.push(call)

            if (options.waitForAbort) {
                await new Promise<void>((resolve) => {
                    if (signal.aborted) {
                        resolve()
                        return
                    }

                    signal.addEventListener('abort', () => resolve(), {
                        once: true,
                    })
                })

                signal.throwIfAborted()
            }

            if (options.error) throw options.error

            if (typeof options.reply === 'function') {
                return await options.reply(call)
            }

            return options.reply ?? '回复'
        },

        async models() {
            modelCalls.push(runtime.provider)

            if (options.modelsError) throw options.modelsError

            return options.models ?? ['model-a', 'model-b']
        },
    })

    return { factory, calls, modelCalls }
}
