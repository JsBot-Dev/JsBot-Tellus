import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    openDatabase,
    openMemoryDatabase,
} from '../../src/core/storage/database.js'

describe('database', () => {
    let directory: string

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'jsbot-db-'))
    })

    afterEach(async () => {
        await rm(directory, {
            recursive: true,
            force: true,
        })
    })

    it('creates the database and tables', () => {
        const database = openDatabase({
            dataDir: directory,
        })

        database.close()

        const connection = new DatabaseSync(join(directory, 'bot.db'))
        const rows = connection
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
            )
            .all() as Array<{ name: string }>

        connection.close()

        expect(rows.map((row) => row.name)).toEqual(
            expect.arrayContaining(['plugin_kv', 'sessions'])
        )
    })

    it('creates the data directory', async () => {
        const nested = join(directory, 'nested', 'data')
        const database = openDatabase({ dataDir: nested })

        database.close()

        const connection = new DatabaseSync(join(nested, 'bot.db'))
        connection.close()
    })

    it('supports a custom file name', () => {
        const database = openDatabase({
            dataDir: directory,
            fileName: 'custom.db',
        })

        database.close()

        const connection = new DatabaseSync(join(directory, 'custom.db'))
        connection.close()
    })

    it('closes idempotently', () => {
        const database = openMemoryDatabase()

        expect(() => {
            database.close()
            database.close()
        }).not.toThrow()
    })
})
