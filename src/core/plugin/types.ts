import type {
    OneBotMessageEvent,
    OneBotNoticeEvent,
    OneBotRequestEvent,
    OutgoingMessage,
    SnowLumaEvent,
} from '@snowluma/sdk'
import type { z } from 'zod'
import type { BotApi } from '../api.js'
import type { TaskQueue } from '../dispatch/task-queue.js'
import type { Logger } from '../logging/logger.js'
import type { SendOptions } from '../messaging/sender.js'
import type { PluginKV } from '../plugin/kv.js'
import type { Permission } from '../security/permission.js'
import type { SessionStore } from '../storage/session.js'
import type { CommandParamArgs } from './command-params.js'

export type EventType = 'message' | 'notice' | 'request' | 'meta'

export interface CommandMatch {
    command: string
    prefix: string
    args: string[]
    rest: string
}

export interface CommandInfo {
    name: string
    aliases: string[]
    permission: Permission
    description?: string | undefined
    usage?: string | undefined
    pluginId: string
}

export interface EventContext<TEvent extends SnowLumaEvent = SnowLumaEvent> {
    readonly event: TEvent
    readonly sessionId: string
    readonly command: CommandMatch | null
    readonly stopped: boolean

    send(message: OutgoingMessage, options?: SendOptions): Promise<unknown>

    stopPropagation(): void
}

export type CommandHandler<
    TEvent extends OneBotMessageEvent = OneBotMessageEvent,
    TArgs extends unknown[] = [],
> = (
    event: TEvent,
    context: EventContext<TEvent>,
    match: CommandMatch,
    ...args: TArgs
) => void | Promise<void>

export type MessageHandler = (
    event: OneBotMessageEvent,
    context: EventContext<OneBotMessageEvent>
) => void | Promise<void>

export type NoticeHandler = (
    event: OneBotNoticeEvent,
    context: EventContext<OneBotNoticeEvent>
) => void | Promise<void>

export type RequestHandler = (
    event: OneBotRequestEvent,
    context: EventContext<OneBotRequestEvent>
) => void | Promise<void>

export type PluginMiddleware = (
    event: SnowLumaEvent,
    context: EventContext,
    next: () => Promise<void>
) => void | Promise<void>

export interface CommandOptions<Declaration extends string = string> {
    name: string
    aliases?: string[] | undefined
    prefixes?: string[] | undefined
    permission?: Permission | undefined
    description?: string | undefined
    params?: Declaration | undefined
}

export interface CommandGroupOptions<
    Declaration extends string = string,
> extends CommandOptions<Declaration> {
    handler?:
        | CommandHandler<OneBotMessageEvent, CommandParamArgs<Declaration>>
        | undefined
}

export interface CommandGroupRegistrar {
    register<Declaration extends string = string>(
        options: CommandOptions<Declaration>,
        handler: CommandHandler<
            OneBotMessageEvent,
            CommandParamArgs<Declaration>
        >
    ): () => void
    group<Declaration extends string = string>(
        options: CommandGroupOptions<Declaration>,
        setup: (group: CommandGroupRegistrar) => void
    ): () => void
}

export interface NoticeOptions {
    noticeType?: string | undefined
    subType?: string | undefined
}

export interface RequestOptions {
    requestType?: string | undefined
}

export interface MiddlewareOptions {
    name?: string | undefined
    eventTypes?: EventType[] | undefined
    priority?: number | undefined
}

export interface CommandRegistrar extends CommandGroupRegistrar {
    list(): ReadonlyArray<CommandInfo>
}

export interface EventRegistrar {
    onMessage(handler: MessageHandler): () => void
    onNotice(options: NoticeOptions, handler: NoticeHandler): () => void
    onRequest(options: RequestOptions, handler: RequestHandler): () => void
}

export interface MiddlewareRegistrar {
    use(options: MiddlewareOptions, handler: PluginMiddleware): () => void
}

export interface PluginStatusEntry {
    id: string
    enabled: boolean
    loaded: boolean
}

export interface PluginStatus {
    list(): PluginStatusEntry[]
}

export interface InstalledPackageInfo {
    packageName: string
    version: string
    spec: string
    pluginIds: string[]
    installedAt: string
    loaded: boolean
}

export interface PluginInstallResult {
    packageName: string
    version: string
    pluginIds: string[]
    warnings: string[]
}

export interface PluginRemoveResult {
    packageName: string
    pluginIds: string[]
    warnings: string[]
}

export interface PluginUpdateResult {
    updated: PluginInstallResult[]
    failed: Array<{ packageName: string; message: string }>
}

export interface PluginInstaller {
    readonly enabled: boolean
    list(): Promise<InstalledPackageInfo[]>
    install(spec: string, signal?: AbortSignal): Promise<PluginInstallResult>
    remove(
        target: string,
        signal?: AbortSignal,
        options?: { force?: boolean | undefined } | undefined
    ): Promise<PluginRemoveResult>
    update(target?: string, signal?: AbortSignal): Promise<PluginUpdateResult>
}

export interface CoreServices {
    roles: {
        roleOf(userId: number): Permission
        can(actual: Permission, required: Permission): boolean
    }
    commands: {
        list(): ReadonlyArray<CommandInfo>
    }
    plugins: PluginStatus
    installer: PluginInstaller
    restart(): void
    uptime(): number
}

export interface PluginContext<TConfig = unknown> {
    readonly id: string
    readonly config: Readonly<TConfig>
    readonly logger: Logger
    readonly kv: PluginKV
    readonly sessions: SessionStore
    readonly tasks: TaskQueue
    readonly api: BotApi
    readonly commands: CommandRegistrar
    readonly events: EventRegistrar
    readonly middlewares: MiddlewareRegistrar
    readonly core: CoreServices
}

export interface PluginManifest<TConfig = unknown> {
    id: string
    version: string
    description?: string | undefined
    dependencies?: string[] | undefined
    priority?: number | undefined
    defaultEnabled?: boolean | undefined
    configSchema: z.ZodType<TConfig>
}

export interface PluginDefinition<TConfig = unknown, TState = void> {
    manifest: PluginManifest<TConfig>
    setup(context: PluginContext<TConfig>): TState | Promise<TState>
    start?(state: TState): void | Promise<void>
    stop?(state: TState): void | Promise<void>
}

export type AnyPluginDefinition = PluginDefinition<unknown, unknown>

export function definePlugin<TConfig, TState = void>(
    definition: PluginDefinition<TConfig, TState>
): PluginDefinition<TConfig, TState> {
    return definition
}
