import type { OneBotMessageEvent } from '@snowluma/sdk'
import { definePlugin } from '../../core/index.js'
import { llmConfigSchema } from './config.js'
import { registerLlmCommands } from './commands.js'
import { mentionsSelf } from './prompt.js'
import { respond } from './respond.js'
import { createOpenAiRuntime } from './runtime.js'
import type { LlmRuntimeFactory, LlmState } from './types.js'

export function createLlmPlugin(
    factory: LlmRuntimeFactory = createOpenAiRuntime
) {
    return definePlugin({
        manifest: {
            id: 'llm',
            version: '2.0.0',
            description: 'Session-scoped LLM chat',
            dependencies: ['core'],
            priority: 100,
            defaultEnabled: false,
            configSchema: llmConfigSchema,
        },

        setup(ctx): LlmState {
            const state: LlmState = {
                runtimes: new Map(),
                lastRequest: new Map(),
                tasks: ctx.tasks,
            }

            registerLlmCommands(ctx, state, factory)

            ctx.events.onMessage(async (event: OneBotMessageEvent, context) => {
                if (event.user_id === event.self_id) return

                if (
                    event.message_type === 'group' &&
                    !mentionsSelf(event, event.self_id)
                ) {
                    return
                }

                const now = Date.now()
                const last = state.lastRequest.get(context.sessionId)

                if (last !== undefined && now - last < ctx.config.rateLimitMs) {
                    return
                }

                state.lastRequest.set(context.sessionId, now)

                ctx.tasks.enqueue(context.sessionId, (signal) =>
                    respond(ctx, state, factory, { event, context }, signal)
                )
            })

            return state
        },

        stop(state) {
            state.tasks.cancelAll()
            state.lastRequest.clear()
            state.runtimes.clear()
        },
    })
}

export const llmPlugin = createLlmPlugin()
