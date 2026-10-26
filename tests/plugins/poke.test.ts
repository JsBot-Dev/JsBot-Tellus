import { describe, expect, it } from 'vitest'
import { pokePlugin } from '../../src/plugins/poke/index.js'
import { pokeNotice } from '../helpers/events.js'
import { createTestApp } from '../helpers/test-app.js'

describe('poke plugin', () => {
    it('only replies when the bot is the target', async () => {
        const app = await createTestApp({
            plugins: [pokePlugin],
            pluginConfigs: {
                poke: { cooldownMs: 60_000 },
            },
        })

        await app.dispatch(pokeNotice({ target_id: 99999 }))
        expect(app.client.sent).toHaveLength(0)

        await app.dispatch(pokeNotice({ target_id: 10000 }))
        expect(app.client.sent).toHaveLength(1)
        expect(app.client.sent[0]?.message).toBe('你戳我干嘛')

        await app.stop()
    })

    it('applies the cooldown per user', async () => {
        const app = await createTestApp({
            plugins: [pokePlugin],
            pluginConfigs: {
                poke: { cooldownMs: 60_000 },
            },
        })

        await app.dispatch(pokeNotice({ user_id: 1 }))
        await app.dispatch(pokeNotice({ user_id: 1 }))
        await app.dispatch(pokeNotice({ user_id: 2 }))

        expect(app.client.sent).toHaveLength(2)

        await app.stop()
    })

    it('supports a zero cooldown', async () => {
        const app = await createTestApp({
            plugins: [pokePlugin],
            pluginConfigs: {
                poke: { cooldownMs: 0 },
            },
        })

        await app.dispatch(pokeNotice())
        await app.dispatch(pokeNotice())

        expect(app.client.sent).toHaveLength(2)

        await app.stop()
    })

    it('respects group gating', async () => {
        const app = await createTestApp({
            plugins: [pokePlugin],
            pluginConfigs: {
                poke: {
                    cooldownMs: 0,
                    groups: {
                        allow: [],
                        deny: [123456],
                    },
                },
            },
        })

        await app.dispatch(pokeNotice({ group_id: 123456 }))

        expect(app.client.sent).toHaveLength(0)

        await app.stop()
    })

    it('uses a custom reply', async () => {
        const app = await createTestApp({
            plugins: [pokePlugin],
            pluginConfigs: {
                poke: {
                    cooldownMs: 0,
                    reply: '别戳了',
                },
            },
        })

        await app.dispatch(pokeNotice())

        expect(app.client.sent[0]?.message).toBe('别戳了')

        await app.stop()
    })
})
