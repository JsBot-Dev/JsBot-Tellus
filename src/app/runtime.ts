import type { SnowLumaEvent } from '@snowluma/sdk'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { AppConfig } from '../core/config/schema.js'
import {
    loadConfig,
    resolveConfigPath,
    resolveDataDir,
} from '../core/config/loader.js'
import { createBotClient } from '../core/client.js'
import { Kernel } from '../core/kernel.js'
import { LogBuffer } from '../core/logging/log-buffer.js'
import {
    createLogger,
    defaultLogSink,
    parseLogLevel,
    type LogSink,
    type Logger,
} from '../core/logging/logger.js'
import { NpmPluginInstaller } from '../core/plugin/installer.js'
import { loadLocalPlugins } from '../core/plugin/loader.js'
import type {
    AnyPluginDefinition,
    PluginInstaller,
} from '../core/plugin/types.js'
import { openDatabase, type Database } from '../core/storage/database.js'
import { ConfigStore } from '../core/web/config-store.js'
import { EventFeed } from '../core/web/event-feed.js'
import type {
    WebUiAddress,
    WebUiDeps,
    WebUiRuntime,
} from '../core/web/types.js'
import { builtinPlugins } from '../plugins/index.js'

export const LOCAL_PLUGIN_DIR = 'plugins'

export interface PluginSource {
    label: string
    plugins: AnyPluginDefinition[]
}

export interface RuntimeSettings {
    logger: Logger
    configPath: string
    dataDir: string
}

export interface RuntimeSpec {
    config: AppConfig
    dataDir: string
    pluginDir: string
    plugins: AnyPluginDefinition[]
}

export interface Runtime {
    spec: RuntimeSpec
    kernel: Kernel
    database: Database
    installer: PluginInstaller
}

export interface StaticBinding {
    host: string
    port: number
}

export interface AppLogging {
    logs: LogBuffer
    events: EventFeed
    logger: Logger
    tapEvents: (event: SnowLumaEvent) => void
}

export function createAppLogging(logLevel: string | undefined): AppLogging {
    const logs = new LogBuffer()
    const events = new EventFeed()
    const tapEvents = (event: SnowLumaEvent): void => {
        events.add(event)
    }
    const sink: LogSink = (record) => {
        defaultLogSink(record)
        logs.push(record)
    }

    const logger = createLogger({
        level: parseLogLevel(logLevel),
        scope: 'app',
        sink,
    })

    return { logs, events, logger, tapEvents }
}

export interface ResolveRuntimeSettingsOptions {
    config: string | undefined
    dataDir: string | undefined
    env: NodeJS.ProcessEnv
}

export function resolveRuntimeSettings(
    logger: Logger,
    options: ResolveRuntimeSettingsOptions
): RuntimeSettings {
    const configPath = resolveConfigPath({
        config: options.config,
        env: options.env,
    })

    const dataDir = resolveDataDir({
        dataDir: options.dataDir,
        env: options.env,
    })

    return {
        logger,
        configPath,
        dataDir,
    }
}

export function mergePlugins(
    sources: PluginSource[],
    logger: Logger
): AnyPluginDefinition[] {
    const seen = new Set<string>()
    const plugins: AnyPluginDefinition[] = []

    for (const source of sources) {
        for (const plugin of source.plugins) {
            const id = plugin.manifest.id

            if (seen.has(id)) {
                logger.warn(
                    `skipping ${source.label} plugin ${id}: plugin id already loaded`
                )
                continue
            }

            seen.add(id)
            plugins.push(plugin)
        }
    }

    return plugins
}

export async function loadRuntimeSpec(
    settings: RuntimeSettings
): Promise<RuntimeSpec> {
    const { logger } = settings

    logger.info('loading config', settings.configPath)

    const config = await loadConfig(settings.configPath)
    const pluginDir = resolve(LOCAL_PLUGIN_DIR)

    logger.info('loading plugins from', pluginDir)

    const localPlugins = await loadLocalPlugins(pluginDir, logger, {
        buildTimeoutMs: config.installer.timeoutMs,
    })

    if (localPlugins.length > 0) {
        logger.info(`loaded ${localPlugins.length} plugin(s) from ${pluginDir}`)
    }

    const plugins = mergePlugins(
        [
            { label: 'built-in', plugins: builtinPlugins },
            { label: 'plugins', plugins: localPlugins },
        ],
        logger
    )

    return {
        config,
        dataDir: settings.dataDir,
        pluginDir,
        plugins,
    }
}

export function createRuntime(
    spec: RuntimeSpec,
    settings: RuntimeSettings,
    onRestart: () => void,
    onEvent: (event: SnowLumaEvent) => void
): Runtime {
    const { logger } = settings
    const installer = new NpmPluginInstaller({
        dir: spec.pluginDir,
        config: spec.config.installer,
        logger: logger.child('installer'),
        reservedIds: () =>
            new Set(spec.plugins.map((plugin) => plugin.manifest.id)),
        configuredPluginIds: () => new Set(Object.keys(spec.config.plugins)),
    })
    const database = openDatabase({ dataDir: spec.dataDir })

    const client = createBotClient({
        url: spec.config.url,
        ...(spec.config.accessToken
            ? { accessToken: spec.config.accessToken }
            : {}),
    })

    const kernel = new Kernel({
        config: spec.config,
        client,
        logger,
        database,
        plugins: spec.plugins,
        installer,
        onRestart,
        onEvent,
    })

    return { spec, kernel, database, installer }
}

export function describeError(error: unknown): string {
    if (error instanceof Error) {
        return error.stack ?? `${error.name}: ${error.message}`
    }

    return String(error)
}

export function credentialSignature(config: AppConfig): string {
    const webui = config.webui

    return [webui.username ?? '', webui.password ?? ''].join(':')
}

export function resolveStaticDir(scriptDir: string): string | null {
    const candidates = [
        join(scriptDir, 'webui'),
        resolve(process.cwd(), 'dist/webui'),
    ]

    for (const candidate of candidates) {
        if (existsSync(join(candidate, 'index.html'))) return candidate
    }

    return null
}

export function readVersion(scriptDir: string): string {
    try {
        const pkgPath = join(scriptDir, '..', 'package.json')
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
            version?: string
        }

        return pkg.version ?? 'unknown'
    } catch {
        return 'unknown'
    }
}

export function createExclusiveRunner(): <T>(
    task: () => Promise<T>
) => Promise<T> {
    let tail: Promise<unknown> = Promise.resolve()

    return <T>(task: () => Promise<T>): Promise<T> => {
        const run = tail.then(task, task)

        tail = run.then(
            () => undefined,
            () => undefined
        )

        return run
    }
}

export function restartDrainTimeout(previous: Runtime | null): number {
    const installTimeout = previous?.spec.config.installer.timeoutMs ?? 5_000

    return Math.max(installTimeout, 5_000) * 2 + 5_000
}

export interface StartInitialRuntimeOptions {
    spec: RuntimeSpec
    settings: RuntimeSettings
    requestRestart: () => void
    onEvent: (event: SnowLumaEvent) => void
    getCurrentConfig: () => AppConfig
    hasWebUi: boolean
    onFailure: () => Promise<void>
    setRuntime: (runtime: Runtime | null) => void
    generation: number
    credentials: string
}

export interface InitialRuntimeResult {
    generation: number
    startupError: string | null
    credentials: string
}

export async function startInitialRuntime(
    options: StartInitialRuntimeOptions
): Promise<InitialRuntimeResult> {
    const { spec, settings, requestRestart, onEvent, getCurrentConfig } =
        options
    const { logger } = settings

    try {
        const runtime = createRuntime(spec, settings, requestRestart, onEvent)

        options.setRuntime(runtime)

        await runtime.kernel.start()

        const credentials = credentialSignature(getCurrentConfig())

        logger.info('runtime started')

        return {
            generation: 1,
            startupError: null,
            credentials,
        }
    } catch (error) {
        options.setRuntime(null)

        logger.error('runtime startup failed', error)

        if (!options.hasWebUi) {
            await options.onFailure()
        } else {
            logger.info(
                'webui stays online; fix the configuration on the config page and restart the runtime'
            )
        }

        return {
            generation: options.generation,
            startupError: describeError(error),
            credentials: options.credentials,
        }
    }
}

export interface ShutdownOptions {
    logger: Logger
    isShuttingDown: () => boolean
    onBegin: () => void
    getRuntime: () => Runtime | null
    stopServer: () => Promise<void>
}

export function createShutdown(
    options: ShutdownOptions
): (signal: string, exitCode?: number) => Promise<void> {
    return async (signal, exitCode = 0) => {
        if (options.isShuttingDown()) return

        options.onBegin()

        options.logger.info(`received ${signal}, shutting down`)

        try {
            await options.getRuntime()?.kernel.stop()
            await options.stopServer()
            process.exit(exitCode)
        } catch (error) {
            options.logger.error('shutdown failed', error)
            process.exit(1)
        }
    }
}

export function registerShutdownSignals(
    shutdown: (signal: string, exitCode?: number) => Promise<void>
): void {
    process.once('SIGINT', () => {
        void shutdown('SIGINT')
    })

    process.once('SIGTERM', () => {
        void shutdown('SIGTERM')
    })
}

export function createSerialRunner<T>(run: () => Promise<T>): () => Promise<T> {
    let tail: Promise<unknown> = Promise.resolve()

    return () => {
        const result = tail.then(run, run)

        tail = result.then(
            () => undefined,
            () => undefined
        )

        return result
    }
}

export interface RestartRequesterOptions {
    isShuttingDown: () => boolean
    isRestarting: () => boolean
    markPending: () => void
    restart: () => Promise<boolean>
}

export interface RestartRequester {
    request(): void
    clear(): void
}

export function createRestartRequester(
    options: RestartRequesterOptions
): RestartRequester {
    let timer: NodeJS.Timeout | null = null

    return {
        request: () => {
            if (options.isShuttingDown()) return

            if (options.isRestarting()) {
                options.markPending()
                return
            }

            if (timer !== null) return

            timer = setTimeout(() => {
                timer = null
                void options.restart()
            }, 250)
        },
        clear: () => {
            if (timer === null) return

            clearTimeout(timer)
            timer = null
        },
    }
}

export interface WebUiDepsOptions {
    logger: Logger
    configPath: string
    dataDir: string
    pluginDir: string
    staticDir: string | null
    version: string
    logs: LogBuffer
    events: EventFeed
    store: ConfigStore
    getCurrentConfig: () => AppConfig
    getRuntime: () => Runtime | null
    getGeneration: () => number
    restart: () => Promise<boolean>
    requestRestart: () => void
    getListening: () => WebUiAddress | null
    invalidateSessions: () => void
    runExclusive: <T>(task: () => Promise<T>) => Promise<T>
    isRestarting: () => boolean
    getStartupError: () => string | null
    getBoundWebUi: () => StaticBinding | null
}

export function createWebUiDeps(options: WebUiDepsOptions): WebUiDeps {
    return {
        logger: options.logger.child('webui'),
        paths: {
            configPath: options.configPath,
            dataDir: options.dataDir,
            pluginDir: options.pluginDir,
            staticDir: options.staticDir,
        },
        version: options.version,
        logs: options.logs,
        events: options.events,
        getWebUiConfig: () => options.getCurrentConfig().webui,
        readConfig: () => options.store.read(),
        validateConfig: (value) => options.store.validate(value),
        applyConfig: (value, baseHash) => options.store.apply(value, baseHash),
        restart: () => options.restart(),
        requestRestart: options.requestRestart,
        pause: () => options.getRuntime()?.kernel.pause(),
        resume: () => options.getRuntime()?.kernel.resume(),
        getListening: () => options.getListening(),
        invalidateSessions: () => options.invalidateSessions(),
        runExclusive: (task) => options.runExclusive(task),
        getRuntime: (): WebUiRuntime | null => {
            const runtime = options.getRuntime()

            return runtime === null
                ? null
                : {
                      generation: options.getGeneration(),
                      config: runtime.spec.config,
                      kernel: runtime.kernel,
                      api: runtime.kernel.api,
                      database: runtime.database,
                      installer: runtime.installer,
                      plugins: runtime.spec.plugins,
                  }
        },
        isRestarting: () => options.isRestarting(),
        getStartupError: () => options.getStartupError(),
        getRequiresProcessRestart: () => {
            const webui = options.getCurrentConfig().webui
            const boundWebUi = options.getBoundWebUi()

            if (boundWebUi === null) return webui.enabled

            if (!webui.enabled) return true

            return (
                webui.host !== boundWebUi.host || webui.port !== boundWebUi.port
            )
        },
    }
}
