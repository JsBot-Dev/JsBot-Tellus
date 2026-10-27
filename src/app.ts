#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { createBotClient } from './core/client.js'
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
import { resolveInstallDir } from './core/plugin/install-dir.js'
import { NpmPluginInstaller } from './core/plugin/installer.js'
import { loadInstalledPlugins } from './core/plugin/installed.js'
import { loadPluginsFromDirectory } from './core/plugin/loader.js'
import type { AnyPluginDefinition } from './core/plugin/types.js'
import { openDatabase } from './core/storage/database.js'
import { builtinPlugins } from './plugins/index.js'

const USAGE = `Usage: jsbot [options]

Options:
  --config <path>      Config file path (env: BOT_CONFIG)
  --data-dir <path>    Data directory (env: BOT_DATA_DIR)
  --log-level <level>  debug, info, warn or error (env: BOT_LOG_LEVEL)
  --plugin-dir <path>  External plugin directory, repeatable (env: BOT_PLUGIN_DIR)
  --help               Show this help

Config precedence: CLI > environment > ./bot.config.v2.json.
Data precedence: CLI > environment > ./data-v2.
`

function pick(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
        ? value
        : undefined
}

function pickDirs(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
    }

    if (typeof value !== 'string') return []

    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
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

async function loadExternalPlugins(
    directories: string[],
    logger: Logger
): Promise<AnyPluginDefinition[]> {
    const plugins: AnyPluginDefinition[] = []

    for (const directory of directories) {
        logger.info('loading external plugins', directory)
        plugins.push(...(await loadPluginsFromDirectory(directory)))
    }

    return plugins
}

async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            config: { type: 'string' },
            'data-dir': { type: 'string' },
            'log-level': { type: 'string' },
            'plugin-dir': { type: 'string', multiple: true },
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

    logger.info('loading config', configPath)

    const config = await loadConfig(configPath)

    const dataDir = resolveDataDir({
        dataDir: pick(values['data-dir']),
        env: process.env,
    })

    const cliPluginDirs = pickDirs(values['plugin-dir'])
    const envPluginDirs = pickDirs(process.env.BOT_PLUGIN_DIR)
    const pluginDirs = cliPluginDirs.length > 0 ? cliPluginDirs : envPluginDirs
    const externalPlugins = await loadExternalPlugins(pluginDirs, logger)
    const installDir = resolveInstallDir(config.installer, dataDir)
    const installed = await loadInstalledPlugins(installDir, logger)

    if (installed.plugins.length > 0) {
        logger.info(
            `loaded ${installed.plugins.length} plugin(s) from ${installDir}`
        )
    }

    const plugins = mergePlugins(
        [
            { label: 'built-in', plugins: builtinPlugins },
            { label: 'external', plugins: externalPlugins },
            { label: 'installed', plugins: installed.plugins },
        ],
        logger
    )
    const installer = new NpmPluginInstaller({
        dir: installDir,
        config: config.installer,
        logger: logger.child('installer'),
        reservedIds: () => new Set(plugins.map((plugin) => plugin.manifest.id)),
        configuredPluginIds: () => new Set(Object.keys(config.plugins)),
    })
    const database = openDatabase({ dataDir })

    const client = createBotClient({
        url: config.url,
        ...(config.accessToken ? { accessToken: config.accessToken } : {}),
    })

    const kernel = new Kernel({
        config,
        client,
        logger,
        database,
        plugins,
        installer,
    })

    let shuttingDown = false

    const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) return

        shuttingDown = true
        logger.info(`received ${signal}, shutting down`)

        try {
            await kernel.stop()
            process.exit(0)
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

    await kernel.start()
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
