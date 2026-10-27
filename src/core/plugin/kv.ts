import type { Database } from '../storage/database.js'

export interface PluginKV {
    get<T>(key: string): Promise<T | undefined>
    set<T>(key: string, value: T): Promise<void>
    delete(key: string): Promise<boolean>
    clear(): Promise<void>
    list<T>(prefix?: string): Promise<Array<{ key: string; value: T }>>
}

interface KVRow {
    key: string
    value: string
}

export class SqlitePluginKV implements PluginKV {
    constructor(
        private readonly database: Database,
        private readonly pluginId: string
    ) {}

    async get<T>(key: string): Promise<T | undefined> {
        const row = this.database.connection
            .prepare(
                'SELECT value FROM plugin_kv WHERE plugin_id = ? AND key = ?'
            )
            .get(this.pluginId, key) as { value: string } | undefined

        if (!row) return undefined

        return JSON.parse(row.value) as T
    }

    async set<T>(key: string, value: T): Promise<void> {
        const serialized = JSON.stringify(value)

        if (serialized === undefined) {
            throw new TypeError(`plugin kv value is not serializable: ${key}`)
        }

        this.database.connection
            .prepare(
                `INSERT INTO plugin_kv (plugin_id, key, value, updated_at)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(plugin_id, key) DO UPDATE SET
                     value = excluded.value,
                     updated_at = excluded.updated_at`
            )
            .run(this.pluginId, key, serialized, Date.now())
    }

    async delete(key: string): Promise<boolean> {
        const result = this.database.connection
            .prepare('DELETE FROM plugin_kv WHERE plugin_id = ? AND key = ?')
            .run(this.pluginId, key)

        return Number(result.changes) > 0
    }

    async clear(): Promise<void> {
        this.database.connection
            .prepare('DELETE FROM plugin_kv WHERE plugin_id = ?')
            .run(this.pluginId)
    }

    async list<T>(prefix?: string): Promise<Array<{ key: string; value: T }>> {
        const rows = this.database.connection
            .prepare(
                'SELECT key, value FROM plugin_kv WHERE plugin_id = ? ORDER BY key'
            )
            .all(this.pluginId) as unknown as KVRow[]

        return rows
            .filter((row) => prefix === undefined || row.key.startsWith(prefix))
            .map((row) => ({
                key: row.key,
                value: JSON.parse(row.value) as T,
            }))
    }
}
