import { SnowLumaWebSocketClient, type OutgoingMessage } from '@snowluma/sdk'
import type {
    CommandMeta,
    JsBotOptions,
    Plugins,
    Registrations,
    CommandContext,
} from './types/type'
import { PluginManager } from './plugin/manager'
import type { Config } from './config/schema'
import { ConfigManager } from './config/config'
import { KvData } from './kv/kv'
import {
    createAuthMiddleware,
    createPermissionMiddleware,
} from './security/middleware'
import send_msg_impl from '../utils/sendmsg'
import logger from './logger/logger'

class JsBot {
    private readonly botLogger = new logger('[Bot]')
    private readonly configLogger = new logger('[Bot::Config]')
    private readonly sdkLogger = new logger('[Bot::SDK]')
    private readonly startupLogger = new logger('[Bot::Start]')
    private readonly pluginLogger = new logger('[Bot::Plugin]')
    private readonly registrationLogger = new logger('[Bot::Register]')
    private readonly connectionLogger = new logger('[Bot::Connect]')
    private readonly kvLogger = new logger('[Bot::KV]')
    private readonly shutdownLogger = new logger('[Bot::Stop]')

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
        this.botLogger.info('正在初始化 Bot')
        this.configManager = new ConfigManager()
        this.configLogger.info('正在读取并校验配置')
        try {
            this.config = this.configManager.read.read()
        } catch (error) {
            this.configLogger.error('配置加载失败', error)
            throw error
        }
        this.configLogger.info('配置加载完成')
        this.client = new SnowLumaWebSocketClient({
            url: this.config.url,
            accessToken: this.config.accessToken,
            reconnect: true,
        })
        this.connectionLogger.info('WebSocket 客户端初始化完成')
        this.client.on('error', (error) => {
            this.sdkLogger.error('客户端错误', error)
        })
        this.client.on('close', ({ code, reason }) => {
            this.sdkLogger.warn(
                `WebSocket 连接已关闭${code === undefined ? '' : `（代码 ${code}）`}${reason ? `：${reason}` : ''}`
            )
        })
        this.pluginManager = new PluginManager()
        this.pluginLogger.info('插件管理器初始化完成')
    }

    send_msg(ctx: CommandContext, message: OutgoingMessage) {
        return send_msg_impl(ctx, message, this.config)
    }

    start(): Promise<void> {
        if (this.stopping) {
            this.startupLogger.warn('Bot 正在停止，拒绝启动请求')
            return Promise.reject(new Error('Bot is shutting down'))
        }
        if (this.started) {
            this.startupLogger.debug('Bot 已启动，跳过本次启动请求')
            return Promise.resolve()
        }
        if (this.startPromise) {
            this.startupLogger.debug('Bot 正在启动，复用当前启动任务')
            return this.startPromise
        }

        this.startupLogger.info('收到启动请求')
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
        this.startupLogger.info('Bot 启动流程开始')
        try {
            if (!this.registered) {
                this.registrationLogger.info('正在初始化插件注册信息')
                this.registrations = {
                    commands: new Map<string, CommandMeta>(),
                    middlewares: [],
                    handlers: [],
                }
                this.pluginLogger.info('正在加载插件')
                const constructors = await this.pluginManager.load.load()
                this.pluginLogger.info('插件加载完成', {
                    internal: constructors.internal.map(
                        (Plugin) => Plugin.name
                    ),
                    integrated: constructors.integrated.map(
                        (Plugin) => Plugin.name
                    ),
                    custom: constructors.custom.map((Plugin) => Plugin.name),
                })
                try {
                    this.kvLogger.info('正在初始化插件 KV 数据库')
                    this.plugiDb = new KvData(constructors)
                    this.pluginLogger.info('正在创建插件实例')
                    this.plugins = this.pluginManager.load.instantiate(
                        this,
                        constructors
                    )
                    this.pluginLogger.info('插件实例创建完成', {
                        internal: this.plugins.internal.length,
                        integrated: this.plugins.integrated.length,
                        custom: this.plugins.custom.length,
                    })
                    const disposers: Array<() => void> = []
                    try {
                        this.registrationLogger.info('正在注册权限中间件')
                        disposers.push(
                            this.client.use(createPermissionMiddleware(this))
                        )
                        this.registrationLogger.info('正在注册鉴权中间件')
                        disposers.push(
                            this.client.use(createAuthMiddleware(this))
                        )
                        this.registrationLogger.info(
                            '正在注册插件命令、事件和中间件'
                        )
                        disposers.push(
                            ...this.pluginManager.register.register(this)
                        )
                        this.disposers = disposers
                        this.registered = true
                        this.registrationLogger.info('事件注册完成', {
                            commands: this.registrations.commands.size,
                            middlewares: this.registrations.middlewares.length,
                            handlers: this.registrations.handlers.length,
                        })
                    } catch (error) {
                        this.registrationLogger.error(
                            '事件注册失败，正在回滚已注册的处理器',
                            error
                        )
                        for (const dispose of disposers.reverse()) dispose()
                        throw error
                    }
                } catch (error) {
                    // A failed constructor or registration must not leave an open database for retry.
                    if (this.plugiDb) {
                        this.kvLogger.warn('初始化失败，正在关闭插件 KV 数据库')
                        const database = this.plugiDb.db as unknown as {
                            close(): void
                        }
                        database.close()
                    }
                    this.plugiDb = undefined
                    throw error
                }
            }
            if (this.stopping) {
                this.startupLogger.warn('Bot 正在停止，取消连接前的启动流程')
                return
            }
            this.connectionLogger.info('正在连接 WebSocket 服务端')
            await this.client.connect()
            if (!this.stopping) {
                this.started = true
                this.startupLogger.info('Bot 启动完成')
            } else {
                this.connectionLogger.warn(
                    'Bot 停止过程中 WebSocket 已连接，不标记为启动完成'
                )
            }
        } catch (error) {
            this.startupLogger.error('Bot 启动失败', error)
            throw error
        } finally {
            this.starting = false
            this.startupLogger.debug('本次 Bot 启动流程结束')
        }
    }

    stop(): Promise<void> {
        if (this.stopPromise) return this.stopPromise
        this.shutdownLogger.info('收到停止请求')
        this.stopping = true
        this.stopPromise = this.stopOnce()
        return this.stopPromise
    }

    private async stopOnce() {
        try {
            this.shutdownLogger.info('正在关闭 WebSocket 客户端')
            this.client.close()
            try {
                if (this.startPromise)
                    this.shutdownLogger.info('等待正在进行的启动流程结束')
                await this.startPromise
            } catch {
                // Closing during startup may reject the pending connection.
            }
        } finally {
            this.shutdownLogger.info('正在清理已注册的处理器')
            for (const dispose of this.disposers.reverse()) dispose()
            this.disposers = []
            this.registered = false
            // KVSqlite inherits close() from better-sqlite3, but its published types omit it.
            if (this.plugiDb) {
                this.kvLogger.info('正在关闭插件 KV 数据库')
                const database = this.plugiDb.db as unknown as {
                    close(): void
                }
                database.close()
            }
            this.plugiDb = undefined
            this.started = false
            this.starting = false
            this.stopping = false
            this.stopPromise = null
            this.shutdownLogger.info('Bot 已停止')
        }
    }
}

export { JsBot }
