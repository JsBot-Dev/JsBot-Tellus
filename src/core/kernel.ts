import type { SnowLumaEvent } from '@snowluma/sdk'
import type { BotClient } from './client.js'
import type { AppConfig } from './config/schema.js'
import { createBotApi, type BotApi } from './api.js'
import { Router } from './dispatch/router.js'
import { PerKeyTaskQueue } from './dispatch/task-queue.js'
import { Lifecycle, type LifecycleState } from './lifecycle/lifecycle.js'
import type { Logger } from './logging/logger.js'
import { createMessageSender } from './messaging/sender.js'
import { createPluginContext } from './plugin/context.js'
import { PluginGate } from './plugin/gating.js'
import { PluginHost } from './plugin/host.js'
import { createDisabledInstaller } from './plugin/installer.js'
import { SqlitePluginKV } from './plugin/kv.js'
import type {
    AnyPluginDefinition,
    CoreServices,
    PluginInstaller,
} from './plugin/types.js'
import { RoleService } from './security/roles.js'
import type { Database } from './storage/database.js'
import { SqliteSessionStore } from './storage/session.js'

export interface KernelOptions {
    config: AppConfig
    client: BotClient
    logger: Logger
    database: Database
    plugins?: AnyPluginDefinition[] | undefined
    installer?: PluginInstaller | undefined
    onRestart?: (() => void) | undefined
    onEvent?: ((event: SnowLumaEvent) => void) | undefined
    drainTimeoutMs?: number | undefined
}

export class Kernel {
    readonly api: BotApi

    private readonly config: AppConfig
    private readonly client: BotClient
    private readonly logger: Logger
    private readonly database: Database
    private readonly router: Router
    private readonly host: PluginHost
    private readonly tasks: PerKeyTaskQueue
    private readonly lifecycle: Lifecycle
    private readonly drainTimeoutMs: number
    private startedAt: number | null = null

    constructor(options: KernelOptions) {
        this.config = options.config
        this.client = options.client
        this.logger = options.logger
        this.database = options.database
        this.drainTimeoutMs = options.drainTimeoutMs ?? 5_000

        const definitions = options.plugins ?? []
        const roles = new RoleService(options.config.roles)
        const gate = new PluginGate(definitions, options.config.plugins)
        const sessions = new SqliteSessionStore(options.database)
        const sender = createMessageSender({
            client: options.client,
            message: options.config.message,
            logger: options.logger,
        })
        const tasks = new PerKeyTaskQueue(options.logger)
        const api = createBotApi(options.client, sender)

        this.api = api
        this.tasks = tasks
        this.router = new Router({
            sender,
            roles,
            gate,
            logger: options.logger,
            ...(options.onEvent !== undefined
                ? { onEvent: options.onEvent }
                : {}),
        })

        let host: PluginHost

        const core: CoreServices = {
            roles: {
                roleOf: (userId) => roles.roleOf(userId),
                can: (actual, required) => roles.can(actual, required),
            },
            commands: {
                list: (event) =>
                    event === undefined
                        ? this.router.listCommands()
                        : this.router
                              .listCommands()
                              .filter((command) =>
                                  gate.isEnabled(command.pluginId, event)
                              ),
            },
            plugins: {
                list: () => host.listStatus(),
            },
            installer: options.installer ?? createDisabledInstaller(),
            restart: options.onRestart ?? (() => {}),
            uptime: () =>
                this.startedAt === null ? 0 : Date.now() - this.startedAt,
        }

        host = new PluginHost({
            definitions,
            configs: options.config.plugins,
            gate,
            router: this.router,
            logger: options.logger,
            createContext: (definition, config) =>
                createPluginContext(definition, {
                    config,
                    router: this.router,
                    logger: options.logger,
                    core,
                    kv: new SqlitePluginKV(
                        options.database,
                        definition.manifest.id
                    ),
                    sessions,
                    tasks,
                    api,
                }),
        })

        this.host = host
        this.client.use(this.router.dispatch as Parameters<BotClient['use']>[0])

        this.lifecycle = new Lifecycle({
            onStart: () => this.startKernel(),
            onStop: () => this.stopKernel(),
        })
    }

    get state(): LifecycleState {
        return this.lifecycle.state
    }

    get uptimeMs(): number {
        return this.startedAt === null ? 0 : Date.now() - this.startedAt
    }

    get isConnected(): boolean {
        return this.client.isConnected
    }

    listPlugins() {
        return this.host.listStatus()
    }

    listCommands() {
        return this.router.listCommands()
    }

    start(): Promise<void> {
        return this.lifecycle.start()
    }

    stop(): Promise<void> {
        return this.lifecycle.stop()
    }

    pause(): void {
        this.router.accepting = false
        this.logger.debug('kernel paused')
    }

    resume(): void {
        if (this.lifecycle.state !== 'running') return

        this.router.accepting = true
        this.logger.debug('kernel resumed')
    }

    async drain(timeoutMs = 5_000): Promise<boolean> {
        const deadline = Date.now() + timeoutMs

        for (;;) {
            if (!(await this.tasks.drain(Math.max(deadline - Date.now(), 0)))) {
                return false
            }

            if (
                !(await this.router.drain(Math.max(deadline - Date.now(), 0)))
            ) {
                return false
            }

            // A finishing event handler may have enqueued another task.
            if (await this.tasks.drain(0)) return true

            if (Date.now() >= deadline) return false
        }
    }

    private async startKernel(): Promise<void> {
        this.router.accepting = false
        this.startedAt = null
        this.logger.debug('connecting to', this.config.url)

        try {
            await this.host.setup()
            await this.client.connect()
            await this.host.start()

            this.startedAt = Date.now()
            this.router.accepting = true
            this.logger.info('kernel started')
        } catch (error) {
            this.router.accepting = false
            await this.stopKernel()
            this.logger.error('kernel start failed', error)
            throw error
        }
    }

    private async stopKernel(): Promise<void> {
        this.router.accepting = false

        try {
            const drained = await this.drain(this.drainTimeoutMs)

            if (!drained) {
                this.logger.warn('task queue drain timed out, cancelling')
            }

            this.tasks.cancelAll()
            await this.host.stop()
        } finally {
            this.startedAt = null
            this.closeClient()
            this.closeDatabase()
            this.logger.info('kernel stopped')
        }
    }

    private closeClient(): void {
        try {
            this.client.close()
        } catch (error) {
            this.logger.error('client close failed', error)
        }
    }

    private closeDatabase(): void {
        try {
            this.database.close()
        } catch (error) {
            this.logger.error('database close failed', error)
        }
    }
}
