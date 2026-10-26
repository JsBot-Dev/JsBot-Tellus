import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface OpenDatabaseOptions {
    dataDir: string
    fileName?: string | undefined
}

export interface Database {
    readonly connection: DatabaseSync
    close(): void
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS plugin_kv (
    plugin_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (plugin_id, key)
);

CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    provider TEXT,
    model TEXT,
    persona TEXT,
    messages TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
`

export function openDatabase(options: OpenDatabaseOptions): Database {
    const inMemory = options.dataDir === ':memory:'
    const fileName = options.fileName ?? 'bot.db'

    if (!inMemory) {
        mkdirSync(options.dataDir, { recursive: true })
    }

    const filePath = inMemory ? ':memory:' : join(options.dataDir, fileName)

    const connection = new DatabaseSync(filePath)

    connection.exec('PRAGMA journal_mode = WAL;')
    connection.exec('PRAGMA foreign_keys = ON;')
    connection.exec(SCHEMA)

    let closed = false

    return {
        connection,
        close() {
            if (closed) return

            closed = true
            connection.close()
        },
    }
}

export function openMemoryDatabase(): Database {
    return openDatabase({ dataDir: ':memory:' })
}
