import { describe, expect, it } from 'vitest'
import { adminPlugin } from '../../src/plugins/admin/index.js'
import { groupMessage } from '../helpers/events.js'
import { createTestApp } from '../helpers/test-app.js'

function sentMessages(sent: Array<{ message: unknown }>): string[] {
    return sent.map((item) => String(item.message))
}

describe('admin plugin', () => {
    it('requires admin for utter', async () => {
        const app = await createTestApp({
            plugins: [adminPlugin],
            roles: {
                superadmin: [],
                admin: [20000],
            },
        })

        await app.dispatch(
            groupMessage({
                raw_message: '/utter hello',
                user_id: 30000,
            })
        )

        expect(sentMessages(app.client.sent)[0]).toContain('权限不足')

        await app.stop()
    })

    it('sends text for admins', async () => {
        const app = await createTestApp({
            plugins: [adminPlugin],
            roles: {
                superadmin: [],
                admin: [20000],
            },
        })

        await app.dispatch(
            groupMessage({
                raw_message: '/utter hello world',
                user_id: 20000,
            })
        )

        expect(sentMessages(app.client.sent)).toEqual(['hello world'])

        await app.stop()
    })

    it('requires superadmin for raw CQ messages', async () => {
        const app = await createTestApp({
            plugins: [adminPlugin],
            roles: {
                superadmin: [10000],
                admin: [20000],
            },
        })

        await app.dispatch(
            groupMessage({
                raw_message: '/utter.raw [CQ:face,id=1]',
                user_id: 20000,
            })
        )

        expect(sentMessages(app.client.sent)[0]).toContain('权限不足')

        await app.dispatch(
            groupMessage({
                raw_message: '/utter.raw [CQ:face,id=1]',
                user_id: 10000,
            })
        )

        expect(sentMessages(app.client.sent).at(-1)).toBe('[CQ:face,id=1]')

        await app.stop()
    })

    it('shows usage for an empty command', async () => {
        const app = await createTestApp({
            plugins: [adminPlugin],
            roles: {
                superadmin: [10000],
                admin: [],
            },
        })

        const result = await app.dispatch(
            groupMessage({
                raw_message: '/utter',
                user_id: 10000,
            })
        )

        expect(sentMessages(result.replies)[0]).toContain('用法')

        await app.stop()
    })
})
