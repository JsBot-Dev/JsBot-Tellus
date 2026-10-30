import { describe, expect, it } from 'vitest'
import { SqliteSessionStore } from '../../src/core/storage/session.js'
import { openMemoryDatabase } from '../../src/core/storage/database.js'

describe('session store', () => {
    it('returns null for a missing session', async () => {
        const database = openMemoryDatabase()
        const sessions = new SqliteSessionStore(database)

        expect(await sessions.get('group:1')).toBeNull()
        expect(await sessions.history('group:1')).toEqual([])

        database.close()
    })

    it('saves and loads state', async () => {
        const database = openMemoryDatabase()
        const sessions = new SqliteSessionStore(database)

        await sessions.save({
            sessionId: 'group:1',
            provider: 'test',
            model: 'model',
            persona: 'helper',
            messages: [{ role: 'user', content: 'hi', at: 1 }],
            updatedAt: 2,
        })

        expect(await sessions.get('group:1')).toEqual({
            sessionId: 'group:1',
            provider: 'test',
            model: 'model',
            persona: 'helper',
            messages: [{ role: 'user', content: 'hi', at: 1 }],
            updatedAt: 2,
        })

        database.close()
    })

    it('appends while preserving settings', async () => {
        const database = openMemoryDatabase()
        const sessions = new SqliteSessionStore(database)

        await sessions.append('private:1', {
            role: 'user',
            content: 'one',
            at: 1,
        })
        await sessions.save({
            ...(await sessions.get('private:1'))!,
            model: 'x',
        })
        await sessions.append('private:1', {
            role: 'assistant',
            content: 'two',
            at: 2,
        })

        const state = await sessions.get('private:1')

        expect(state?.model).toBe('x')
        expect(state?.messages).toEqual([
            { role: 'user', content: 'one', at: 1 },
            { role: 'assistant', content: 'two', at: 2 },
        ])

        database.close()
    })

    it('does not lose concurrent appends', async () => {
        const database = openMemoryDatabase()
        const sessions = new SqliteSessionStore(database)

        await Promise.all(
            Array.from({ length: 20 }, (_, index) =>
                sessions.append('group:1', {
                    role: 'user',
                    content: String(index),
                    at: index,
                })
            )
        )

        const state = await sessions.get('group:1')

        expect(state?.messages).toHaveLength(20)
        expect(new Set(state?.messages.map((item) => item.content)).size).toBe(
            20
        )

        database.close()
    })

    it('limits history to the most recent messages', async () => {
        const database = openMemoryDatabase()
        const sessions = new SqliteSessionStore(database)

        await sessions.replace('group:1', [
            { role: 'user', content: '1', at: 1 },
            { role: 'assistant', content: '2', at: 2 },
            { role: 'user', content: '3', at: 3 },
        ])

        expect(await sessions.history('group:1', 2)).toEqual([
            { role: 'assistant', content: '2', at: 2 },
            { role: 'user', content: '3', at: 3 },
        ])
        expect(await sessions.history('group:1', 0)).toEqual([])

        database.close()
    })

    it('replaces messages and clears sessions', async () => {
        const database = openMemoryDatabase()
        const sessions = new SqliteSessionStore(database)

        await sessions.replace('group:1', [
            { role: 'user', content: '1', at: 1 },
        ])
        await sessions.clear('group:1')

        expect(await sessions.get('group:1')).toBeNull()

        database.close()
    })

    it('lists sessions with message counts and pagination', async () => {
        const database = openMemoryDatabase()
        const sessions = new SqliteSessionStore(database)

        await sessions.save({
            sessionId: 'group:1',
            messages: [
                { role: 'user', content: '1', at: 1 },
                { role: 'assistant', content: '2', at: 2 },
            ],
            updatedAt: 10,
        })
        await sessions.save({
            sessionId: 'private:2',
            provider: 'test',
            model: 'model',
            messages: [{ role: 'user', content: '3', at: 3 }],
            updatedAt: 20,
        })

        const all = await sessions.list()

        expect(all).toHaveLength(2)
        expect(all[0]?.sessionId).toBe('private:2')
        expect(all[0]?.messageCount).toBe(1)
        expect(all[0]?.provider).toBe('test')
        expect(all[1]?.messageCount).toBe(2)

        const filtered = await sessions.list({ query: 'group' })

        expect(filtered.map((item) => item.sessionId)).toEqual(['group:1'])

        const page = await sessions.list({ limit: 1, offset: 1 })

        expect(page.map((item) => item.sessionId)).toEqual(['group:1'])
        expect(await sessions.count()).toBe(2)
        expect(await sessions.count('private')).toBe(1)

        database.close()
    })
})
