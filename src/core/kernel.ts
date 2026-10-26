import type { BotClient } from './client.js'
import type { AppConfig } from './config/schema.js'
import { createBotApi } from './api.js'
import { Router } from './dispatch/router.js'
import { PerKeyTaskQueue } from './dispatch/task-queue.js'
import { Lifecycle, type LifecycleState } from './lifecycle/lifecycle.js'
import type { Logger } from './logging/logger.js'
import { createMessageSender } from './messaging/sender.js'
import { createPluginContext } from './plugin/context.js'
import { PluginGate } from './plugin/gating.js'
import { PluginHost } from './plugin/host.js'
import { SqlitePluginKV } from './plugin/kv.js'
import type { AnyPluginDefinition, CoreServices } from './plugin/types.js'
import { RoleService } from './security/roles.js'
import type { Database } from './storage/database.js'
import { SqliteSessionStore } from './storage/session.js'

export interface KernelOptions {
    config: AppConfig
    client: BotClient
    logger: Logger
    database: Database
    plugins?: AnyPluginDefinition[] | undefined
    drainTimeoutMs?: number | undefined
}

export class Kernel {
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

        this.tasks = tasks
        this.router = new Router({
            sender,
            roles,
            gate,
            logger: options.logger,
        })

        let host: PluginHost

        const core: CoreServices = {
            roles: {
                roleOf: (userId) => roles.roleOf(userId),
                can: (actual, required) => roles.can(actual, required),
            },
            commands: {
                list: () => this.router.listCommands(),
            },
            plugins: {
                list: () => host.listStatus(),
            },
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
        this.client.use(this.router.dispatch)

        this.lifecycle = new Lifecycle({
            onStart: () => this.startKernel(),
            onStop: () => this.stopKernel(),
        })
    }

    get state(): LifecycleState {
        return this.lifecycle.state
    }

    start(): Promise<void> {
        return this.lifecycle.start()
    }

    stop(): Promise<void> {
        return this.lifecycle.stop()
    }

    drain(timeoutMs = 5_000): Promise<boolean> {
        return this.tasks.drain(timeoutMs)
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
            const drained = await this.tasks.drain(this.drainTimeoutMs)

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
