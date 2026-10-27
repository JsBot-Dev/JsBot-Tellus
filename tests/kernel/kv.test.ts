import { describe, expect, it } from 'vitest'
import { SqlitePluginKV } from '../../src/core/plugin/kv.js'
import { openMemoryDatabase } from '../../src/core/storage/database.js'

describe('plugin kv', () => {
    it('stores typed values', async () => {
        const database = openMemoryDatabase()
        const kv = new SqlitePluginKV(database, 'test')

        await kv.set('count', 3)
        await kv.set('object', { name: 'bot' })

        expect(await kv.get<number>('count')).toBe(3)
        expect(await kv.get<{ name: string }>('object')).toEqual({
            name: 'bot',
        })
        expect(await kv.get('missing')).toBeUndefined()

        database.close()
    })

    it('overwrites values', async () => {
        const database = openMemoryDatabase()
        const kv = new SqlitePluginKV(database, 'test')

        await kv.set('key', 'a')
        await kv.set('key', 'b')

        expect(await kv.get('key')).toBe('b')

        database.close()
    })

    it('deletes keys', async () => {
        const database = openMemoryDatabase()
        const kv = new SqlitePluginKV(database, 'test')

        await kv.set('key', 1)

        expect(await kv.delete('key')).toBe(true)
        expect(await kv.delete('key')).toBe(false)
        expect(await kv.get('key')).toBeUndefined()

        database.close()
    })

    it('rejects values that cannot be serialized', async () => {
        const database = openMemoryDatabase()
        const kv = new SqlitePluginKV(database, 'test')

        await expect(kv.set('missing', undefined)).rejects.toThrow(
            /not serializable/
        )

        database.close()
    })

    it('keeps plugin namespaces separate', async () => {
        const database = openMemoryDatabase()
        const first = new SqlitePluginKV(database, 'first')
        const second = new SqlitePluginKV(database, 'second')

        await first.set('key', 'a')
        await second.set('key', 'b')

        expect(await first.get('key')).toBe('a')
        expect(await second.get('key')).toBe('b')

        first.clear()

        expect(await first.list()).toEqual([])
        expect(await second.list()).toHaveLength(1)

        database.close()
    })

    it('lists keys with a prefix', async () => {
        const database = openMemoryDatabase()
        const kv = new SqlitePluginKV(database, 'test')

        await kv.set('a:1', 1)
        await kv.set('a:2', 2)
        await kv.set('b:1', 3)

        expect(await kv.list<number>('a:')).toEqual([
            { key: 'a:1', value: 1 },
            { key: 'a:2', value: 2 },
        ])
        expect(await kv.list()).toHaveLength(3)

        database.close()
    })
})
