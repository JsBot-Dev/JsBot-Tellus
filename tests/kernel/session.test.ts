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
})
