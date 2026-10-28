import type { OneBotMessageEvent } from '@snowluma/sdk'
import type { BotApi } from '../api.js'
import type { Router } from '../dispatch/router.js'
import type { TaskQueue } from '../dispatch/task-queue.js'
import type { Logger } from '../logging/logger.js'
import type { SessionStore } from '../storage/session.js'
import type { PluginKV } from './kv.js'
import type {
    CommandGroupOptions,
    CommandGroupRegistrar,
    CommandHandler,
    CommandOptions,
    CoreServices,
    PluginContext,
    PluginDefinition,
} from './types.js'

export interface PluginContextDeps {
    config: unknown
    router: Router
    logger: Logger
    core: CoreServices
    kv: PluginKV
    sessions: SessionStore
    tasks: TaskQueue
    api: BotApi
}

export function createPluginContext<TConfig>(
    definition: PluginDefinition<TConfig, unknown>,
    deps: PluginContextDeps
): PluginContext<TConfig> {
    const id = definition.manifest.id

    return {
        id,
        config: deps.config as Readonly<TConfig>,
        logger: deps.logger.child(id),
        kv: deps.kv,
        sessions: deps.sessions,
        tasks: deps.tasks,
        api: deps.api,
        core: deps.core,

        commands: {
            register<TArgs extends unknown[] = []>(
                options: CommandOptions,
                handler: CommandHandler<OneBotMessageEvent, TArgs>
            ) {
                return deps.router.registerCommand({
                    pluginId: id,
                    name: options.name,
                    ...(options.aliases !== undefined
                        ? { aliases: options.aliases }
                        : {}),
                    ...(options.prefixes !== undefined
                        ? { prefixes: options.prefixes }
                        : {}),
                    ...(options.permission !== undefined
                        ? { permission: options.permission }
                        : {}),
                    ...(options.description !== undefined
                        ? { description: options.description }
                        : {}),
                    ...(options.params !== undefined
                        ? { params: options.params }
                        : {}),
                    handler,
                })
            },
            group<TArgs extends unknown[] = []>(
                options: CommandGroupOptions<TArgs>,
                setup: (group: CommandGroupRegistrar) => void
            ) {
                return deps.router.registerCommandGroup(
                    {
                        pluginId: id,
                        name: options.name,
                        ...(options.aliases !== undefined
                            ? { aliases: options.aliases }
                            : {}),
                        ...(options.prefixes !== undefined
                            ? { prefixes: options.prefixes }
                            : {}),
                        ...(options.permission !== undefined
                            ? { permission: options.permission }
                            : {}),
                        ...(options.description !== undefined
                            ? { description: options.description }
                            : {}),
                        ...(options.params !== undefined
                            ? { params: options.params }
                            : {}),
                        ...(options.handler !== undefined
                            ? { handler: options.handler }
                            : {}),
                    },
                    setup
                )
            },
            list() {
                return deps.router.listCommands()
            },
        },

        events: {
            onMessage(handler) {
                return deps.router.registerMessage(id, handler)
            },
            onNotice(options, handler) {
                return deps.router.registerNotice({
                    pluginId: id,
                    ...(options.noticeType !== undefined
                        ? { noticeType: options.noticeType }
                        : {}),
                    ...(options.subType !== undefined
                        ? { subType: options.subType }
                        : {}),
                    handler,
                })
            },
            onRequest(options, handler) {
                return deps.router.registerRequest({
                    pluginId: id,
                    ...(options.requestType !== undefined
                        ? { requestType: options.requestType }
                        : {}),
                    handler,
                })
            },
        },

        middlewares: {
            use(options, handler) {
                return deps.router.registerMiddleware({
                    pluginId: id,
                    ...(options.name !== undefined
                        ? { name: options.name }
                        : {}),
                    ...(options.eventTypes !== undefined
                        ? { eventTypes: options.eventTypes }
                        : {}),
                    ...(options.priority !== undefined
                        ? { priority: options.priority }
                        : {}),
                    handler,
                })
            },
        },
    }
}
