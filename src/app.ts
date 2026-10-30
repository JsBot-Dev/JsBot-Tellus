#!/usr/bin/env node
import type { SnowLumaEvent } from '@snowluma/sdk'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createBotClient } from './core/client.js'
import type { AppConfig } from './core/config/schema.js'
import {
    ConfigError,
    loadConfig,
    resolveConfigPath,
    resolveDataDir,
} from './core/config/loader.js'
import { Kernel } from './core/kernel.js'
import { ConfigStore } from './core/web/config-store.js'
import { EventFeed } from './core/web/event-feed.js'
import { LogBuffer } from './core/logging/log-buffer.js'
import {
    createLogger,
    defaultLogSink,
    parseLogLevel,
    type LogSink,
    type Logger,
} from './core/logging/logger.js'
import { NpmPluginInstaller } from './core/plugin/installer.js'
import { loadLocalPlugins } from './core/plugin/loader.js'
import type {
    AnyPluginDefinition,
    PluginInstaller,
} from './core/plugin/types.js'
import { openDatabase, type Database } from './core/storage/database.js'
import { WebUiServer } from './core/web/server.js'
import type { WebUiAddress, WebUiDeps } from './core/web/types.js'
import { builtinPlugins } from './plugins/index.js'

const LOCAL_PLUGIN_DIR = 'plugins'

const USAGE = `Usage: jsbot [options]

Options:
  --config <path>      Config file path (env: BOT_CONFIG)
  --data-dir <path>    Data directory (env: BOT_DATA_DIR)
  --log-level <level>  debug, info, warn or error (env: BOT_LOG_LEVEL)
  --help               Show this help

Config precedence: CLI > environment > ./bot.config.json.
Data precedence: CLI > environment > ./data.
Local plugins: ./${LOCAL_PLUGIN_DIR}/<id>/dist (auto-built when missing).
`

function pick(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
        ? value
        : undefined
}

interface PluginSource {
    label: string
    plugins: AnyPluginDefinition[]
}

function mergePlugins(
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

interface RuntimeSettings {
    logger: Logger
    configPath: string
    dataDir: string
}

interface RuntimeSpec {
    config: AppConfig
    dataDir: string
    pluginDir: string
    plugins: AnyPluginDefinition[]
}

interface Runtime {
    spec: RuntimeSpec
    kernel: Kernel
    database: Database
    installer: PluginInstaller
}

interface StaticBinding {
    host: string
    port: number
}

async function loadRuntimeSpec(
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

function createRuntime(
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

function describeError(error: unknown): string {
    if (error instanceof Error) {
        return error.stack ?? `${error.name}: ${error.message}`
    }

    return String(error)
}

function credentialSignature(config: AppConfig): string {
    const webui = config.webui

    return [webui.username ?? '', webui.password ?? ''].join(':')
}

function resolveStaticDir(): string | null {
    const scriptDir = dirname(fileURLToPath(import.meta.url))
    const candidates = [
        join(scriptDir, 'webui'),
        resolve(process.cwd(), 'dist/webui'),
    ]

    for (const candidate of candidates) {
        if (existsSync(join(candidate, 'index.html'))) return candidate
    }

    return null
}

function readVersion(): string {
    try {
        const pkgPath = new URL('../package.json', import.meta.url)
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
            version?: string
        }

        return pkg.version ?? 'unknown'
    } catch {
        return 'unknown'
    }
}

async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            config: { type: 'string' },
            'data-dir': { type: 'string' },
            'log-level': { type: 'string' },
            help: { type: 'boolean', short: 'h' },
        },
        allowPositionals: false,
    })

    if (values.help) {
        process.stdout.write(USAGE)
        return
    }

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
        level: parseLogLevel(
            pick(values['log-level']) ?? process.env.BOT_LOG_LEVEL
        ),
        scope: 'app',
        sink,
    })

    const configPath = resolveConfigPath({
        config: pick(values.config),
        env: process.env,
    })

    const dataDir = resolveDataDir({
        dataDir: pick(values['data-dir']),
        env: process.env,
    })

    const settings: RuntimeSettings = {
        logger,
        configPath,
        dataDir,
    }

    // Config file errors remain fatal: there is nothing the WebUI can restore
    // from when the config cannot even be parsed.
    const initialSpec = await loadRuntimeSpec(settings)

    let runtime: Runtime | null = null
    let currentConfig: AppConfig = initialSpec.config
    let generation = 0
    let startupError: string | null = null
    let shuttingDown = false
    let restarting = false
    let restartPending = false
    let restartTimer: NodeJS.Timeout | null = null
    let restartTail: Promise<boolean> = Promise.resolve(true)
    let exclusiveTail: Promise<unknown> = Promise.resolve()
    let boundWebUi: StaticBinding | null = null
    let credentials = credentialSignature(initialSpec.config)

    const restartDrainTimeout = (previous: Runtime | null): number => {
        const installTimeout =
            previous?.spec.config.installer.timeoutMs ?? 5_000

        return Math.max(installTimeout, 5_000) * 2 + 5_000
    }

    const restartRuntimeOnce = async (): Promise<boolean> => {
        if (shuttingDown) return false

        restarting = true
        restartPending = false

        const previous = runtime

        logger.info('restarting runtime')

        try {
            previous?.kernel.pause()

            const drainTimeout = restartDrainTimeout(previous)

            if (previous !== null) {
                const drained = await previous.kernel.drain(drainTimeout)

                if (!drained) {
                    logger.warn('runtime restart drain timed out, cancelling')
                }

                restartPending = false

                if (shuttingDown) return false

                await previous.kernel.stop()
            }

            if (shuttingDown) return false

            const spec = await loadRuntimeSpec(settings)

            currentConfig = spec.config

            const next = createRuntime(
                spec,
                settings,
                requestRestart,
                tapEvents
            )

            runtime = next
            await next.kernel.start()

            generation += 1
            startupError = null

            const signature = credentialSignature(currentConfig)

            if (signature !== credentials) {
                credentials = signature
                server.invalidateSessions()
            }

            logger.info('runtime restarted')

            return true
        } catch (error) {
            runtime = null
            startupError = describeError(error)
            logger.error('runtime restart failed', error)

            return false
        } finally {
            restarting = false

            if (restartPending && !shuttingDown) {
                restartPending = false
                requestRestart()
            }
        }
    }

    const restartRuntime = (): Promise<boolean> => {
        const run = restartTail.then(restartRuntimeOnce, restartRuntimeOnce)

        restartTail = run.then(
            () => true,
            () => false
        )

        return run
    }

    const requestRestart = (): void => {
        if (shuttingDown) return

        if (restarting) {
            restartPending = true
            return
        }

        if (restartTimer !== null) return

        restartTimer = setTimeout(() => {
            restartTimer = null
            void restartRuntime()
        }, 250)
    }

    const store = new ConfigStore({
        configPath,
        getPlugins: () => runtime?.spec.plugins ?? [],
        restart: () => restartRuntime(),
    })

    const deps: WebUiDeps = {
        logger: logger.child('webui'),
        paths: {
            configPath,
            dataDir,
            pluginDir: initialSpec.pluginDir,
            staticDir: resolveStaticDir(),
        },
        version: readVersion(),
        logs,
        events,
        getWebUiConfig: () => currentConfig.webui,
        readConfig: () => store.read(),
        validateConfig: (value) => store.validate(value),
        applyConfig: (value, baseHash) => store.apply(value, baseHash),
        restart: () => restartRuntime(),
        requestRestart,
        pause: () => runtime?.kernel.pause(),
        resume: () => runtime?.kernel.resume(),
        getListening: () => server.address,
        invalidateSessions: () => server.invalidateSessions(),
        runExclusive: async <T>(task: () => Promise<T>): Promise<T> => {
            const run = exclusiveTail.then(task, task)

            exclusiveTail = run.then(
                () => undefined,
                () => undefined
            )

            return run
        },
        getRuntime: () =>
            runtime === null
                ? null
                : {
                      generation,
                      config: runtime.spec.config,
                      kernel: runtime.kernel,
                      api: runtime.kernel.api,
                      database: runtime.database,
                      installer: runtime.installer,
                      plugins: runtime.spec.plugins,
                  },
        isRestarting: () => restarting,
        getStartupError: () => startupError,
        getRequiresProcessRestart: () => {
            const webui = currentConfig.webui

            if (boundWebUi === null) return webui.enabled

            if (!webui.enabled) return true

            return (
                webui.host !== boundWebUi.host || webui.port !== boundWebUi.port
            )
        },
    }

    const server = new WebUiServer({
        config: initialSpec.config.webui,
        deps,
    })

    const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
        if (shuttingDown) return

        shuttingDown = true

        if (restartTimer !== null) {
            clearTimeout(restartTimer)
            restartTimer = null
        }

        logger.info(`received ${signal}, shutting down`)

        try {
            await runtime?.kernel.stop()
            await server.stop()
            process.exit(exitCode)
        } catch (error) {
            logger.error('shutdown failed', error)
            process.exit(1)
        }
    }

    process.once('SIGINT', () => {
        void shutdown('SIGINT')
    })

    process.once('SIGTERM', () => {
        void shutdown('SIGTERM')
    })

    // Start the WebUI before the kernel so it stays online when startup fails.
    if (initialSpec.config.webui.enabled) {
        const address: WebUiAddress | null = await server.start(
            initialSpec.config.webui
        )

        if (address !== null) {
            boundWebUi = {
                host: address.host,
                port: address.port,
            }
        }
    }

    try {
        runtime = createRuntime(
            initialSpec,
            settings,
            requestRestart,
            tapEvents
        )
        await runtime.kernel.start()

        generation = 1
        startupError = null
        credentials = credentialSignature(currentConfig)
        logger.info('runtime started')
    } catch (error) {
        runtime = null
        startupError = describeError(error)
        logger.error('runtime startup failed', error)

        if (boundWebUi === null) {
            await shutdown('startup failure', 1)
        } else {
            logger.info(
                'webui stays online; fix the configuration on the config page and restart the runtime'
            )
        }
    }
}

await main().catch((error: unknown) => {
    if (error instanceof ConfigError) {
        console.error(error.message)
    } else {
        console.error(
            error instanceof Error
                ? (error.stack ?? error.message)
                : String(error)
        )
    }

    process.exitCode = 1
})
