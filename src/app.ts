#!/usr/bin/env node
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createBotClient } from './core/client.js'
import type { AppConfig } from './core/config/schema.js'
import {
    ConfigError,
    loadConfig,
    resolveConfigPath,
    resolveDataDir,
} from './core/config/loader.js'
import { Kernel } from './core/kernel.js'
import {
    createLogger,
    parseLogLevel,
    type Logger,
} from './core/logging/logger.js'
import { NpmPluginInstaller } from './core/plugin/installer.js'
import { loadLocalPlugins } from './core/plugin/loader.js'
import type { AnyPluginDefinition } from './core/plugin/types.js'
import { openDatabase } from './core/storage/database.js'
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
    onRestart: () => void
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
    })

    return { spec, kernel }
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

    const logger = createLogger({
        level: parseLogLevel(
            pick(values['log-level']) ?? process.env.BOT_LOG_LEVEL
        ),
        scope: 'app',
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

    let runtime: Runtime | null = null
    let shuttingDown = false
    let restarting = false
    let restartPending = false
    let restartTimer: NodeJS.Timeout | null = null

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
            process.exit(exitCode)
        } catch (error) {
            logger.error('shutdown failed', error)
            process.exit(1)
        }
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

    const restartDrainTimeout = (previous: Runtime | null): number => {
        const installTimeout =
            previous?.spec.config.installer.timeoutMs ?? 5_000

        return Math.max(installTimeout, 5_000) * 2 + 5_000
    }

    const restartRuntime = async (): Promise<void> => {
        if (shuttingDown || restarting) return

        restarting = true
        restartPending = false

        const previous = runtime
        let stopped = false
        let restarted = false

        logger.info('restarting runtime')

        try {
            // Stop accepting new events so no command can start another install
            // while the replacement runtime is being prepared.
            previous?.kernel.pause()

            const drainTimeout = restartDrainTimeout(previous)
            const drained =
                previous === null
                    ? true
                    : await previous.kernel.drain(drainTimeout)

            // Restart requests raised by drained tasks are covered by the spec
            // loaded below; requests that arrive later are preserved.
            restartPending = false

            if (shuttingDown) return

            let spec: RuntimeSpec

            if (drained) {
                spec = await loadRuntimeSpec(settings)

                if (shuttingDown) return

                await previous?.kernel.stop()
                stopped = true
            } else {
                logger.warn(
                    'runtime restart drain timed out, cancelling pending tasks'
                )

                await previous?.kernel.stop()
                stopped = true

                // Kernel.stop() aborts pending tasks. Wait for their rollback
                // to finish before the replacement runtime touches the same
                // install directory.
                const settled =
                    previous === null
                        ? true
                        : await previous.kernel.drain(drainTimeout)

                if (!settled) {
                    logger.warn(
                        'cancelled tasks are still running after restart drain'
                    )
                }

                if (shuttingDown) return

                spec = await loadRuntimeSpec(settings)
            }

            if (shuttingDown) return

            runtime = createRuntime(spec, settings, requestRestart)
            await runtime.kernel.start()
            restarted = true
            logger.info('runtime restarted')
        } catch (error) {
            logger.error('runtime restart failed', error)

            if (!stopped) {
                previous?.kernel.resume()
                return
            }

            if (previous !== null) {
                try {
                    await runtime?.kernel.stop()
                    runtime = createRuntime(
                        previous.spec,
                        settings,
                        requestRestart
                    )
                    await runtime.kernel.start()
                    logger.warn('restored previous runtime')
                    return
                } catch (fallbackError) {
                    logger.error(
                        'failed to restore previous runtime',
                        fallbackError
                    )
                }
            }

            await shutdown('restart failure', 1)
        } finally {
            restarting = false

            if (restarted && restartPending && !shuttingDown) {
                restartPending = false
                requestRestart()
            }
        }
    }

    process.once('SIGINT', () => {
        void shutdown('SIGINT')
    })

    process.once('SIGTERM', () => {
        void shutdown('SIGTERM')
    })

    const spec = await loadRuntimeSpec(settings)
    runtime = createRuntime(spec, settings, requestRestart)
    await runtime.kernel.start()
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
