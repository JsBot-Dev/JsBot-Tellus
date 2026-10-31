import { SqlitePluginKV } from '../../plugin/kv.js'
import { HttpError, readJsonBody, sendData } from '../http.js'
import {
    asRecord,
    clampInt,
    requireRuntime,
    type ApiContext,
} from './shared.js'

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

export async function handleKvPlugins(ctx: ApiContext): Promise<void> {
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

export async function handleKvList(ctx: ApiContext): Promise<void> {
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

export async function handleKvPut(ctx: ApiContext): Promise<void> {
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

export async function handleKvDelete(ctx: ApiContext): Promise<void> {
    const runtime = requireRuntime(ctx.deps)
    const pluginId = assertPluginId(ctx.search.get('pluginId') ?? '')
    const key = assertKey(ctx.search.get('key') ?? '')
    const deleted = await new SqlitePluginKV(runtime.database, pluginId).delete(
        key
    )

    sendData(ctx.res, 200, { ok: deleted })
}
