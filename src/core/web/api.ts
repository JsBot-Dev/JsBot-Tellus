import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from '../storage/database.js'
import { SqlitePluginKV } from '../plugin/kv.js'
import { stripPluginEnvelope } from '../plugin/host.js'
import {
    SqliteSessionStore,
    type SessionMessage,
    type SessionRole,
    type SessionState,
} from '../storage/session.js'
import { logLevels, type LogLevel } from '../logging/logger.js'
import type { AuthSession } from './auth.js'
import type { FeedEventType } from './event-feed.js'
import { maskConfig } from './config-store.js'
import type { WebUiDeps, WebUiRuntime } from './types.js'
import {
    HttpError,
    isRecord,
    readJsonBody,
    sendData,
    withTimeout,
    type URLSearchParamsLike,
} from './http.js'

export interface ApiContext {
    deps: WebUiDeps
    req: IncomingMessage
    res: ServerResponse
    method: string
    pathname: string
    segments: string[]
    search: URLSearchParamsLike
    session: AuthSession
}

type MaybeParams = URLSearchParams | URLSearchParamsLike

const MAX_SESSION_MESSAGES = 10_000

interface LoginValue {
    userId: number
    nickname: string
}

const loginCache = new WeakMap<
    WebUiRuntime,
    { at: number; value: LoginValue | null }
>()

function requireRuntime(deps: WebUiDeps): WebUiRuntime {
    const runtime = deps.getRuntime()

    if (!runtime) throw new HttpError(503, '运行时不可用，请稍后再试')

    return runtime
}

function countKvPlugins(database: Database): number {
    const row = database.connection
        .prepare('SELECT COUNT(DISTINCT plugin_id) AS count FROM plugin_kv')
        .get() as { count: number } | undefined

    return row?.count ?? 0
}

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

function clampInt(
    value: string | null,
    fallback: number,
    min: number,
    max: number
): number {
    if (value === null) return fallback

    const parsed = Number.parseInt(value, 10)

    if (!Number.isFinite(parsed)) return fallback

    return Math.min(Math.max(parsed, min), max)
}

function asRecord(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {}
}

function parseSessionMessages(value: unknown): SessionMessage[] {
    if (!Array.isArray(value)) {
        throw new HttpError(400, 'messages must be an array')
    }

    if (value.length > MAX_SESSION_MESSAGES) {
        throw new HttpError(400, 'messages too long')
    }

    return value.map((item, index) => {
        if (!isRecord(item)) {
            throw new HttpError(400, `invalid message at index ${index}`)
        }

        const role = item['role']
        const content = item['content']
        const at = item['at']

        if (role !== 'system' && role !== 'user' && role !== 'assistant') {
            throw new HttpError(400, `invalid message role at index ${index}`)
        }

        if (typeof content !== 'string') {
            throw new HttpError(
                400,
                `invalid message content at index ${index}`
            )
        }

        if (typeof at !== 'number' || !Number.isFinite(at)) {
            throw new HttpError(400, `invalid message time at index ${index}`)
        }

        return { role: role as SessionRole, content, at }
    })
}

function clearableString(
    value: unknown,
    fallback: string | undefined
): string | undefined {
    if (value === null) return undefined
    if (value === undefined) return fallback
    if (typeof value === 'string' && value.trim().length > 0) {
        return value
    }

    return undefined
}

async function handleStatus(ctx: ApiContext): Promise<void> {
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

async function handleLogsList(ctx: ApiContext): Promise<void> {
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

async function handleEventsList(ctx: ApiContext): Promise<void> {
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

async function handleSessionList(ctx: ApiContext): Promise<void> {
    const runtime = requireRuntime(ctx.deps)
    const store = new SqliteSessionStore(runtime.database)
    const limit = clampInt(ctx.search.get('limit'), 50, 1, 200)
    const offset = clampInt(ctx.search.get('offset'), 0, 0, 10_000_000)
    const query = ctx.search.get('query')?.slice(0, 200) || undefined
    const items = await store.list({ limit, offset, query })
    const total = await store.count(query)

    sendData(ctx.res, 200, { items, total, limit, offset })
}

function sessionIdOf(ctx: ApiContext): string {
    const id = ctx.segments[2]

    if (!id) throw new HttpError(404, 'session not found')

    return id
}

function requireSessionStore(ctx: ApiContext): SqliteSessionStore {
    const runtime = requireRuntime(ctx.deps)

    return new SqliteSessionStore(runtime.database)
}

async function sessionDetail(ctx: ApiContext): Promise<SessionState> {
    const id = sessionIdOf(ctx)
    const state = await requireSessionStore(ctx).get(id)

    if (!state) throw new HttpError(404, 'session not found')

    return state
}

async function handleSessionGet(ctx: ApiContext): Promise<void> {
    sendData(ctx.res, 200, await sessionDetail(ctx))
}

async function handleSessionPut(ctx: ApiContext): Promise<void> {
    const body = asRecord(await readJsonBody(ctx.req))
    await sessionDetail(ctx)

    const messages =
        body['messages'] === undefined
            ? undefined
            : parseSessionMessages(body['messages'])

    const baseline = await sessionDetail(ctx)
    const state: SessionState = {
        sessionId: sessionIdOf(ctx),
        provider: clearableString(body['provider'], baseline.provider),
        model: clearableString(body['model'], baseline.model),
        persona: clearableString(body['persona'], baseline.persona),
        messages: messages ?? baseline.messages,
        updatedAt: Date.now(),
    }

    await requireSessionStore(ctx).save(state)
    sendData(ctx.res, 200, state)
}

async function handleSessionMessages(ctx: ApiContext): Promise<void> {
    const body = asRecord(await readJsonBody(ctx.req))
    const role = body['role']
    const content = body['content']

    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
        throw new HttpError(400, 'invalid message role')
    }

    if (
        typeof content !== 'string' ||
        content.length === 0 ||
        content.length > 100_000
    ) {
        throw new HttpError(400, 'invalid message content')
    }

    const state = await sessionDetail(ctx)
    const message = { role: role as SessionRole, content, at: Date.now() }
    const next: SessionState = {
        ...state,
        messages: [...state.messages, message],
        updatedAt: Date.now(),
    }

    await requireSessionStore(ctx).save(next)
    sendData(ctx.res, 200, next)
}

async function handleSessionSend(ctx: ApiContext): Promise<void> {
    const body = asRecord(await readJsonBody(ctx.req))
    const id = sessionIdOf(ctx)
    const message = body['message']
    const autoEscape = body['autoEscape']

    if (
        typeof message !== 'string' ||
        message.length === 0 ||
        message.length > 20_000
    ) {
        throw new HttpError(400, 'invalid message')
    }

    const runtime = requireRuntime(ctx.deps)

    await sessionDetail(ctx)

    const result = await runtime.api.send(
        id,
        message,
        typeof autoEscape === 'boolean' ? { autoEscape } : undefined
    )

    sendData(ctx.res, 200, { result: result ?? null })
}

async function handleSessionDelete(ctx: ApiContext): Promise<void> {
    await requireSessionStore(ctx).clear(sessionIdOf(ctx))
    sendData(ctx.res, 200, { cleared: true })
}

async function handlePluginsList(ctx: ApiContext): Promise<void> {
    const runtime = requireRuntime(ctx.deps)
    const statuses = new Map(
        runtime.kernel.listPlugins().map((entry) => [entry.id, entry])
    )
    const plugins = runtime.plugins.map((definition) => {
        const id = definition.manifest.id
        const status = statuses.get(id)
        const envelope = asRecord(runtime.config.plugins[id]) as Record<
            string,
            unknown
        >

        return {
            id,
            version: definition.manifest.version,
            description: definition.manifest.description,
            dependencies: definition.manifest.dependencies ?? [],
            defaultEnabled: definition.manifest.defaultEnabled ?? false,
            enabled: status?.enabled ?? false,
            loaded: status?.loaded ?? false,
            config: envelope,
            options: stripPluginEnvelope(envelope as never) as Record<
                string,
                unknown
            >,
        }
    })
    const installed = runtime.installer.enabled
        ? await runtime.installer.list()
        : []

    sendData(ctx.res, 200, {
        plugins,
        installed,
        installerEnabled: runtime.installer.enabled,
        configHash: (await ctx.deps.readConfig()).hash,
    })
}

const ENVELOPE_KEYS = new Set(['enabled', 'private', 'groups'])

async function handlePluginConfigPut(ctx: ApiContext): Promise<void> {
    const body = asRecord(await readJsonBody(ctx.req))
    const id = ctx.segments[2]
    const document = await ctx.deps.readConfig()

    if (id === undefined) throw new HttpError(404, 'unknown plugin')

    if (!isRecord(document.config.plugins[id])) {
        throw new HttpError(404, `unknown plugin: ${id}`)
    }

    const existing = asRecord(document.config.plugins[id]) as unknown as Record<
        string,
        unknown
    >
    const next = { ...existing }

    if (typeof body['enabled'] === 'boolean') {
        next['enabled'] = body['enabled']
    }

    if (typeof body['private'] === 'boolean') {
        next['private'] = body['private']
    }

    if (body['groups'] !== undefined) next['groups'] = body['groups']

    if (body['options'] !== undefined) {
        if (!isRecord(body['options'])) {
            throw new HttpError(400, 'options must be an object')
        }

        for (const key of Object.keys(next)) {
            if (!ENVELOPE_KEYS.has(key)) delete next[key]
        }

        for (const [key, value] of Object.entries(body['options'])) {
            if (!ENVELOPE_KEYS.has(key)) next[key] = value
        }
    }

    const config = {
        ...document.config,
        plugins: {
            ...document.config.plugins,
            [id]: next,
        },
    }
    const baseHash = body['baseHash']

    sendData(
        ctx.res,
        200,
        await ctx.deps.applyConfig(
            config,
            typeof baseHash === 'string' ? baseHash : undefined
        )
    )
}

async function handleInstallerAction(ctx: ApiContext): Promise<void> {
    const runtime = requireRuntime(ctx.deps)

    if (!runtime.installer.enabled) {
        throw new HttpError(403, '插件安装器未启用')
    }

    const body = asRecord(await readJsonBody(ctx.req))
    const target = typeof body['target'] === 'string' ? body['target'] : ''
    const spec = typeof body['spec'] === 'string' ? body['spec'] : ''

    if (ctx.pathname.endsWith('/install')) {
        if (!spec) throw new HttpError(400, 'spec is required')

        sendData(
            ctx.res,
            200,
            await ctx.deps.runExclusive(() => runtime.installer.install(spec))
        )

        return
    }

    if (ctx.pathname.endsWith('/update')) {
        sendData(
            ctx.res,
            200,
            await ctx.deps.runExclusive(() =>
                runtime.installer.update(target || undefined)
            )
        )

        return
    }

    sendData(
        ctx.res,
        200,
        await ctx.deps.runExclusive(async () =>
            runtime.installer.remove(target, undefined, {
                force: body['force'] === true,
            })
        )
    )
}

async function handleConfigGet(ctx: ApiContext): Promise<void> {
    const document = await ctx.deps.readConfig()
    const masked = maskConfig(document.config)

    sendData(ctx.res, 200, {
        config: masked.config,
        meta: {
            path: document.path,
            hash: document.hash,
            accessTokenSet: masked.accessTokenSet,
            webuiPasswordSet: masked.webuiPasswordSet,
        },
    })
}

async function handleConfigValidate(ctx: ApiContext): Promise<void> {
    const body = asRecord(await readJsonBody(ctx.req))
    const result = await ctx.deps.validateConfig(body['config'])

    sendData(ctx.res, 200, {
        ok: result.ok,
        issues: result.issues,
    })
}

async function handleConfigPut(ctx: ApiContext): Promise<void> {
    const body = asRecord(await readJsonBody(ctx.req))
    const baseHash = body['baseHash']

    sendData(
        ctx.res,
        200,
        await ctx.deps.applyConfig(
            body['config'],
            typeof baseHash === 'string' ? baseHash : undefined
        )
    )
}

function assertPluginId(value: string): string {
    if (!/^\w[\w.-]*$/.test(value)) {
        throw new HttpError(400, `invalid plugin id: ${value}`)
    }

    return value
}

function assertKey(value: string): string {
    if (value.length === 0 || value.length > 512) {
        throw new HttpError(400, 'invalid key length')
    }

    return value
}

function parseKvValue(value: string): unknown {
    try {
        return JSON.parse(value) as unknown
    } catch {
        return value
    }
}

interface KvRow {
    key: string
    value: string
    updated_at: number
}

async function handleKvPlugins(ctx: ApiContext): Promise<void> {
    const runtime = requireRuntime(ctx.deps)
    const rows = runtime.database.connection
        .prepare(
            'SELECT plugin_id, COUNT(*) AS count FROM plugin_kv GROUP BY plugin_id ORDER BY plugin_id'
        )
        .all() as Array<{ plugin_id: string; count: number }>

    sendData(
        ctx.res,
        200,
        rows.map((row) => ({ pluginId: row.plugin_id, count: row.count }))
    )
}

async function handleKvList(ctx: ApiContext): Promise<void> {
    const runtime = requireRuntime(ctx.deps)
    const pluginId = assertPluginId(ctx.search.get('pluginId') ?? '')
    const prefix = ctx.search.get('prefix') ?? ''
    const limit = clampInt(ctx.search.get('limit'), 100, 1, 500)
    const offset = clampInt(ctx.search.get('offset'), 0, 0, 10_000_000)
    const pattern =
        prefix === ''
            ? '%'
            : `${prefix.replace(/[%_]/g, (match) => `\\${match}`)}%`
    const rows = runtime.database.connection
        .prepare(
            `SELECT key, value, updated_at FROM plugin_kv
             WHERE plugin_id = ? AND key LIKE ? ESCAPE '\\'
             ORDER BY key
             LIMIT ? OFFSET ?`
        )
        .all(pluginId, pattern, limit, offset) as unknown as KvRow[]
    const totalRow = runtime.database.connection
        .prepare(
            `SELECT COUNT(*) AS count FROM plugin_kv
             WHERE plugin_id = ? AND key LIKE ? ESCAPE '\\'`
        )
        .get(pluginId, pattern) as { count: number } | undefined

    sendData(ctx.res, 200, {
        items: rows.map((row) => ({
            pluginId,
            key: row.key,
            value: parseKvValue(row.value),
            updatedAt: row.updated_at,
        })),
        total: totalRow?.count ?? 0,
        limit,
        offset,
    })
}

async function handleKvPut(ctx: ApiContext): Promise<void> {
    const body = asRecord(await readJsonBody(ctx.req))
    const runtime = requireRuntime(ctx.deps)
    const pluginId = assertPluginId(
        typeof body['pluginId'] === 'string' ? body['pluginId'] : ''
    )
    const key = assertKey(typeof body['key'] === 'string' ? body['key'] : '')

    if (typeof body['value'] === 'function') {
        throw new HttpError(400, 'invalid value')
    }

    await new SqlitePluginKV(runtime.database, pluginId).set(
        key,
        body['value'] as never
    )

    sendData(ctx.res, 200, { ok: true })
}

async function handleKvDelete(ctx: ApiContext): Promise<void> {
    const runtime = requireRuntime(ctx.deps)
    const pluginId = assertPluginId(ctx.search.get('pluginId') ?? '')
    const key = assertKey(ctx.search.get('key') ?? '')
    const deleted = await new SqlitePluginKV(runtime.database, pluginId).delete(
        key
    )

    sendData(ctx.res, 200, { ok: deleted })
}

async function handleActions(ctx: ApiContext): Promise<void> {
    const body = asRecord(await readJsonBody(ctx.req))
    const action = body['action']

    if (
        typeof action !== 'string' ||
        action.length === 0 ||
        action.length > 128
    ) {
        throw new HttpError(400, 'action is required')
    }

    const runtime = requireRuntime(ctx.deps)
    const params = body['params'] ?? undefined
    const result = await runtime.api.call(action as never, params as never)

    sendData(ctx.res, 200, { result: result ?? null })
}

async function handleRuntimeCommand(ctx: ApiContext): Promise<void> {
    if (ctx.pathname.endsWith('/restart')) {
        sendData(ctx.res, 200, {
            ok: await ctx.deps.restart(),
        })

        return
    }

    if (ctx.pathname.endsWith('/pause')) {
        ctx.deps.pause()
        sendData(ctx.res, 200, { ok: true })

        return
    }

    if (ctx.pathname.endsWith('/resume')) {
        ctx.deps.resume()
        sendData(ctx.res, 200, { ok: true })
    }
}

export async function handleApiRoute(ctx: ApiContext): Promise<boolean> {
    const { method, pathname } = ctx

    if (method === 'GET' && pathname === '/api/status') {
        await handleStatus(ctx)

        return true
    }

    if (method === 'GET' && pathname === '/api/commands') {
        sendData(ctx.res, 200, requireRuntime(ctx.deps).kernel.listCommands())

        return true
    }

    if (
        method === 'POST' &&
        [
            '/api/runtime/restart',
            '/api/runtime/pause',
            '/api/runtime/resume',
        ].includes(pathname)
    ) {
        await handleRuntimeCommand(ctx)

        return true
    }

    if (method === 'GET' && pathname === '/api/logs') {
        await handleLogsList(ctx)

        return true
    }

    if (method === 'GET' && pathname === '/api/events') {
        await handleEventsList(ctx)

        return true
    }

    if (method === 'GET' && pathname === '/api/sessions') {
        await handleSessionList(ctx)

        return true
    }

    if (
        ctx.segments[0] === 'api' &&
        ctx.segments[1] === 'sessions' &&
        ctx.segments[2] !== undefined
    ) {
        if (ctx.segments[3] === undefined) {
            if (method === 'GET') {
                await handleSessionGet(ctx)

                return true
            }

            if (method === 'PUT') {
                await handleSessionPut(ctx)

                return true
            }

            if (method === 'DELETE') {
                await handleSessionDelete(ctx)

                return true
            }
        } else if (method === 'POST') {
            if (ctx.segments[3] === 'messages') {
                await handleSessionMessages(ctx)

                return true
            }

            if (ctx.segments[3] === 'send') {
                await handleSessionSend(ctx)

                return true
            }

            throw new HttpError(404, `not found: ${pathname}`)
        }

        throw new HttpError(405, `method not allowed: ${method} ${pathname}`)
    }

    if (method === 'GET' && pathname === '/api/plugins') {
        await handlePluginsList(ctx)

        return true
    }

    if (
        method === 'PUT' &&
        ctx.segments[0] === 'api' &&
        ctx.segments[1] === 'plugins' &&
        ctx.segments[3] === 'config'
    ) {
        await handlePluginConfigPut(ctx)

        return true
    }

    if (
        method === 'POST' &&
        [
            '/api/plugins/install',
            '/api/plugins/update',
            '/api/plugins/remove',
        ].includes(pathname)
    ) {
        await handleInstallerAction(ctx)

        return true
    }

    if (method === 'GET' && pathname === '/api/config') {
        await handleConfigGet(ctx)

        return true
    }

    if (method === 'POST' && pathname === '/api/config/validate') {
        await handleConfigValidate(ctx)

        return true
    }

    if (method === 'PUT' && pathname === '/api/config') {
        await handleConfigPut(ctx)

        return true
    }

    if (method === 'GET' && pathname === '/api/kv/plugins') {
        await handleKvPlugins(ctx)

        return true
    }

    if (pathname === '/api/kv' || pathname === '/api/kv/plugins') {
        if (method === 'GET' && pathname === '/api/kv') {
            await handleKvList(ctx)

            return true
        }

        if (method === 'PUT' && pathname === '/api/kv') {
            await handleKvPut(ctx)

            return true
        }

        if (method === 'DELETE' && pathname === '/api/kv') {
            await handleKvDelete(ctx)

            return true
        }
    }

    if (method === 'POST' && pathname === '/api/actions') {
        await handleActions(ctx)

        return true
    }

    return false
}
