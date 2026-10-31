#!/usr/bin/env node
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCli, pick, USAGE } from './app/cli.js'
import {
    createAppLogging,
    createExclusiveRunner,
    createRestartRequester,
    createRuntime,
    createSerialRunner,
    createShutdown,
    createWebUiDeps,
    credentialSignature,
    describeError,
    loadRuntimeSpec,
    readVersion,
    registerShutdownSignals,
    resolveRuntimeSettings,
    resolveStaticDir,
    restartDrainTimeout,
    startInitialRuntime,
    type Runtime,
    type StaticBinding,
} from './app/runtime.js'
import { ConfigError } from './core/config/loader.js'
import type { AppConfig } from './core/config/schema.js'
import { ConfigStore } from './core/web/config-store.js'
import { WebUiServer } from './core/web/server.js'
import type { WebUiAddress } from './core/web/types.js'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

async function main(): Promise<void> {
    const cli = parseCli()

    if (cli.help) {
        process.stdout.write(USAGE)
        return
    }

    const { logs, events, logger, tapEvents } = createAppLogging(
        pick(cli.logLevel) ?? process.env.BOT_LOG_LEVEL
    )

    const settings = resolveRuntimeSettings(logger, {
        config: pick(cli.config),
        dataDir: pick(cli.dataDir),
        env: process.env,
    })

    const { configPath, dataDir } = settings

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
    let boundWebUi: StaticBinding | null = null
    let credentials = credentialSignature(initialSpec.config)

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

    const restartRuntime = createSerialRunner(restartRuntimeOnce)

    const restartRequester = createRestartRequester({
        isShuttingDown: () => shuttingDown,
        isRestarting: () => restarting,
        markPending: () => {
            restartPending = true
        },
        restart: () => restartRuntime(),
    })

    const requestRestart = restartRequester.request

    const store = new ConfigStore({
        configPath,
        getPlugins: () => runtime?.spec.plugins ?? [],
        restart: () => restartRuntime(),
    })

    const runExclusive = createExclusiveRunner()

    const deps = createWebUiDeps({
        logger,
        configPath,
        dataDir,
        pluginDir: initialSpec.pluginDir,
        staticDir: resolveStaticDir(SCRIPT_DIR),
        version: readVersion(SCRIPT_DIR),
        logs,
        events,
        store,
        getCurrentConfig: () => currentConfig,
        getRuntime: () => runtime,
        getGeneration: () => generation,
        restart: () => restartRuntime(),
        requestRestart,
        getListening: () => server.address,
        invalidateSessions: () => server.invalidateSessions(),
        runExclusive,
        isRestarting: () => restarting,
        getStartupError: () => startupError,
        getBoundWebUi: () => boundWebUi,
    })

    const server = new WebUiServer({
        config: initialSpec.config.webui,
        deps,
    })

    const shutdown = createShutdown({
        logger,
        isShuttingDown: () => shuttingDown,
        onBegin: () => {
            shuttingDown = true
            restartRequester.clear()
        },
        getRuntime: () => runtime,
        stopServer: () => server.stop(),
    })

    registerShutdownSignals(shutdown)

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

    const started = await startInitialRuntime({
        spec: initialSpec,
        settings,
        requestRestart,
        onEvent: tapEvents,
        getCurrentConfig: () => currentConfig,
        hasWebUi: boundWebUi !== null,
        onFailure: () => shutdown('startup failure', 1),
        setRuntime: (value) => {
            runtime = value
        },
        generation,
        credentials,
    })

    generation = started.generation
    startupError = started.startupError
    credentials = started.credentials
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
