import { SqliteSessionStore } from '../../storage/session.js'
import { logLevels, type LogLevel } from '../../logging/logger.js'
import type { FeedEventType } from '../event-feed.js'
import type { WebUiDeps, WebUiRuntime } from '../types.js'
import { HttpError, sendData, withTimeout } from '../http.js'
import { clampInt, requireRuntime, type ApiContext } from './shared.js'

interface LoginValue {
    userId: number
    nickname: string
}

const loginCache = new WeakMap<
    WebUiRuntime,
    { at: number; value: LoginValue | null }
>()

async function loginInfo(runtime: WebUiRuntime): Promise<LoginValue | null> {
    if (!runtime.kernel.isConnected) return null

    const cached = loginCache.get(runtime)

    if (cached && Date.now() - cached.at < 10_000) return cached.value

    let value: LoginValue | null = null

    try {
        const info = await withTimeout(runtime.api.getLoginInfo(), 2_000)

        if (typeof info.user_id === 'number') {
            value = {
                userId: info.user_id,
                nickname: info.nickname || String(info.user_id),
            }
        }
    } catch {
        value = null
    }

    loginCache.set(runtime, { at: Date.now(), value })

    return value
}

interface RuntimeStatus {
    generation: number
    state: string
    uptimeMs: number
    connected: boolean
    login: LoginValue | null
    counts: {
        plugins: number
        loadedPlugins: number
        enabledPlugins: number
        sessions: number
        kvPlugins: number
    }
}

function countKvPlugins(database: WebUiRuntime['database']): number {
    const row = database.connection
        .prepare('SELECT COUNT(DISTINCT plugin_id) AS count FROM plugin_kv')
        .get() as { count: number } | undefined

    return row?.count ?? 0
}

async function runtimeStatus(runtime: WebUiRuntime): Promise<RuntimeStatus> {
    const statuses = runtime.kernel.listPlugins()
    const sessions = await new SqliteSessionStore(runtime.database).count()

    return {
        generation: runtime.generation,
        state: runtime.kernel.state,
        uptimeMs: runtime.kernel.uptimeMs,
        connected: runtime.kernel.isConnected,
        login: await loginInfo(runtime),
        counts: {
            plugins: statuses.length,
            loadedPlugins: statuses.filter((entry) => entry.loaded).length,
            enabledPlugins: statuses.filter((entry) => entry.enabled).length,
            sessions,
            kvPlugins: countKvPlugins(runtime.database),
        },
    }
}

function pathsInfo(deps: WebUiDeps) {
    return {
        config: deps.paths.configPath,
        data: deps.paths.dataDir,
        plugins: deps.paths.pluginDir,
    }
}

function assertLevel(value: string): LogLevel {
    if (!(logLevels as readonly string[]).includes(value)) {
        throw new HttpError(400, `invalid log level: ${value}`)
    }

    return value as LogLevel
}

const FEED_TYPES: readonly FeedEventType[] = [
    'message',
    'notice',
    'request',
    'meta',
    'other',
]

function assertFeedType(value: string): FeedEventType {
    if (!FEED_TYPES.includes(value as FeedEventType)) {
        throw new HttpError(400, `invalid event type: ${value}`)
    }

    return value as FeedEventType
}

export async function handleStatus(ctx: ApiContext): Promise<void> {
    const { deps, res } = ctx
    const runtime = deps.getRuntime()
    const webui = {
        listening: deps.getListening(),
        requiresProcessRestart: deps.getRequiresProcessRestart(),
    }

    if (!runtime) {
        sendData(res, 200, {
            restarting: deps.isRestarting(),
            startupError: deps.getStartupError(),
            runtime: null,
            webui,
            version: deps.version,
            paths: pathsInfo(deps),
        })

        return
    }

    sendData(res, 200, {
        restarting: deps.isRestarting(),
        startupError: deps.getStartupError(),
        runtime: await runtimeStatus(runtime),
        webui,
        version: deps.version,
        paths: pathsInfo(deps),
    })
}

export async function handleCommands(ctx: ApiContext): Promise<void> {
    sendData(ctx.res, 200, requireRuntime(ctx.deps).kernel.listCommands())
}

export async function handleLogsList(ctx: ApiContext): Promise<void> {
    const level = ctx.search.get('level')

    if (level) assertLevel(level)

    const scope = ctx.search.get('scope') ?? undefined
    const query = ctx.search.get('query') ?? undefined
    const limit = clampInt(ctx.search.get('limit'), 200, 1, 1_000)

    sendData(
        ctx.res,
        200,
        ctx.deps.logs.list({
            ...(level ? { level: assertLevel(level) } : {}),
            scope,
            query,
            limit,
        })
    )
}

export async function handleEventsList(ctx: ApiContext): Promise<void> {
    const type = ctx.search.get('type')

    if (type) assertFeedType(type)

    const limit = clampInt(ctx.search.get('limit'), 100, 1, 500)

    sendData(
        ctx.res,
        200,
        ctx.deps.events.list({
            ...(type ? { type: assertFeedType(type) } : {}),
            limit,
        })
    )
}
