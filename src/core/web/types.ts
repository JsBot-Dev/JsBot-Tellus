import type { BotApi } from '../api.js'
import type { AppConfig, WebUiConfig } from '../config/schema.js'
import type { Kernel } from '../kernel.js'
import type { LogBuffer } from '../logging/log-buffer.js'
import type { Logger } from '../logging/logger.js'
import type { AnyPluginDefinition, PluginInstaller } from '../plugin/types.js'
import type { Database } from '../storage/database.js'
import type { EventFeed } from './event-feed.js'

export interface WebUiRuntime {
    generation: number
    config: AppConfig
    kernel: Kernel
    api: BotApi
    database: Database
    installer: PluginInstaller
    plugins: AnyPluginDefinition[]
}

export interface WebUiPaths {
    configPath: string
    dataDir: string
    pluginDir: string
    staticDir: string | null
}

export interface WebUiAddress {
    host: string
    port: number
}

export interface ConfigDocument {
    path: string
    raw: string
    hash: string
    config: AppConfig
}

export interface ConfigValidationIssue {
    path: string
    message: string
}

export interface ConfigValidationResult {
    ok: boolean
    issues: ConfigValidationIssue[]
    config?: AppConfig
}

export interface ConfigApplyResult {
    ok: boolean
    hash?: string
    issues?: ConfigValidationIssue[]
    error?: string
}

export interface WebUiDeps {
    logger: Logger
    paths: WebUiPaths
    version: string
    logs: LogBuffer
    events: EventFeed

    /** Current webui settings; picked up after runtime restarts. */
    getWebUiConfig(): WebUiConfig

    readConfig(): Promise<ConfigDocument>
    validateConfig(value: unknown): Promise<ConfigValidationResult>
    applyConfig(
        value: unknown,
        baseHash?: string | undefined
    ): Promise<ConfigApplyResult>

    restart(): Promise<boolean>
    requestRestart(): void
    pause(): void
    resume(): void

    getListening(): WebUiAddress | null
    invalidateSessions(): void
    runExclusive<T>(task: () => Promise<T>): Promise<T>

    getRuntime(): WebUiRuntime | null
    isRestarting(): boolean
    getStartupError(): string | null
    getRequiresProcessRestart(): boolean
}

export interface WebUiServerOptions {
    config: WebUiConfig
    deps: WebUiDeps
    /** Maximum number of concurrent SSE clients. Defaults to 20. */
    maxSseClients?: number | undefined
    /** Maximum JSON request body size. Defaults to 1 MiB. */
    bodyLimitBytes?: number | undefined
    /** Login failures allowed per IP inside the window. Defaults to 5. */
    loginMaxFailures?: number | undefined
    /** Login failure window. Defaults to 15 minutes. */
    loginWindowMs?: number | undefined
}
