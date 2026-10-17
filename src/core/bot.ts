import { SnowLumaWebSocketClient, type OutgoingMessage } from '@snowluma/sdk'
import type {
    CommandMeta,
    JsBotOptions,
    Plugins,
    Registrations,
    CommandContext,
} from './types/type'
import { PluginManager } from './plugin/manager'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Config } from './config/schema'
import { ConfigManager } from './config/config'
import { KvData } from './kv/kv'
import {
    createAuthMiddleware,
    createPermissionMiddleware,
} from './security/middleware'
import send_msg_impl from '../utils/sendmsg'

class JsBot {
    // start status
    starting: boolean = false
    started: boolean = false
    private registered: boolean = false
    private startPromise: Promise<void> | null = null
    private stopPromise: Promise<void> | null = null
    private stopping: boolean = false
    private disposers: Array<() => void> = []

    readonly client: SnowLumaWebSocketClient

    registrations!: Registrations
    plugins!: Plugins
    config!: Config
    pluginManager!: PluginManager
    configManager!: ConfigManager

    plugiDb: KvData | undefined

    constructor() {
        const __dirname = path.dirname(fileURLToPath(import.meta.url))
        this.configManager = new ConfigManager()
        this.config = this.configManager.read.read()
        this.client = new SnowLumaWebSocketClient({
            url: this.config.url,
            accessToken: this.config.accessToken,
            reconnect: true,
        })
        this.client.on('error', (error) => {
            console.error('[SnowLuma SDK]', error)
        })
        this.client.on('close', ({ code, reason }) => {
            console.warn(
                `[SnowLuma SDK] WebSocket closed${code === undefined ? '' : ` (code ${code})`}${reason ? `: ${reason}` : ''}`
            )
        })
        this.pluginManager = new PluginManager()
    }

    send_msg(ctx: CommandContext, message: OutgoingMessage) {
        return send_msg_impl(ctx, message, this.config)
    }

    start(): Promise<void> {
        if (this.stopping)
            return Promise.reject(new Error('Bot is shutting down'))
        if (this.started) return Promise.resolve()
        if (this.startPromise) return this.startPromise

        const attempt = this.startOnce()
        this.startPromise = attempt
        void attempt.then(
            () => {
                this.startPromise = null
            },
            () => {
                this.startPromise = null
            }
        )
        return attempt
    }

    private async startOnce() {
        this.starting = true
        try {
            if (!this.registered) {
                this.registrations = {
                    commands: new Map<string, CommandMeta>(),
                    middlewares: [],
                    handlers: [],
                }
                const constructors = await this.pluginManager.load.load()
                try {
                    this.plugiDb = new KvData(constructors)
                    this.plugins = this.pluginManager.load.instantiate(
                        this,
                        constructors
                    )
                    const disposers: Array<() => void> = []
                    try {
                        disposers.push(
                            this.client.use(createPermissionMiddleware(this))
                        )
                        disposers.push(
                            this.client.use(createAuthMiddleware(this))
                        )
                        disposers.push(
                            ...this.pluginManager.register.register(this)
                        )
                        this.disposers = disposers
                        this.registered = true
                    } catch (error) {
                        for (const dispose of disposers.reverse()) dispose()
                        throw error
                    }
                } catch (error) {
                    // A failed constructor or registration must not leave an open database for retry.
                    if (this.plugiDb)
                        (
                            this.plugiDb.db as unknown as { close(): void }
                        ).close()
                    this.plugiDb = undefined
                    throw error
                }
            }
            if (this.stopping) return
            await this.client.connect()
            if (!this.stopping) this.started = true
        } finally {
            this.starting = false
        }
    }

    stop(): Promise<void> {
        if (this.stopPromise) return this.stopPromise
        this.stopping = true
        this.stopPromise = this.stopOnce()
        return this.stopPromise
    }

    private async stopOnce() {
        try {
            this.client.close()
            try {
                await this.startPromise
            } catch {
                // Closing during startup may reject the pending connection.
            }
        } finally {
            for (const dispose of this.disposers.reverse()) dispose()
            this.disposers = []
            this.registered = false
            // KVSqlite inherits close() from better-sqlite3, but its published types omit it.
            if (this.plugiDb)
                (this.plugiDb.db as unknown as { close(): void }).close()
            this.started = false
        }
    }
}

export { JsBot }
