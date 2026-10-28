import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { definePlugin } from '../../src/core/plugin/types.js'
import { corePlugin } from '../../src/plugins/core/index.js'
import { adminPlugin } from '../../src/plugins/admin/index.js'
import type { FakeEventContext } from '../helpers/event-context.js'
import { groupMessage } from '../helpers/events.js'
import { createTestApp, type TestApp } from '../helpers/test-app.js'

function messageText(app: TestApp, context: FakeEventContext): string {
    return [
        ...context.replies.map((reply) => String(reply.message)),
        ...app.client.sent.map((message) => String(message.message)),
    ].join('\n')
}

describe('core plugin', () => {
    it('reports the current role', async () => {
        const app = await createTestApp({
            plugins: [corePlugin],
            roles: {
                superadmin: [10000],
                admin: [20000],
            },
        })

        const user = await app.dispatch(
            groupMessage({
                raw_message: '/role',
                user_id: 30000,
            })
        )
        const admin = await app.dispatch(
            groupMessage({
                raw_message: '/role',
                user_id: 20000,
            })
        )
        const superadmin = await app.dispatch(
            groupMessage({
                raw_message: '/role',
                user_id: 10000,
            })
        )

        expect(messageText(app, user)).toContain('User')
        expect(messageText(app, admin)).toContain('Admin')
        expect(messageText(app, superadmin)).toContain('SuperAdmin')

        await app.stop()
    })

    it('filters help by permission', async () => {
        const app = await createTestApp({
            plugins: [corePlugin, adminPlugin],
            roles: {
                superadmin: [10000],
                admin: [],
            },
        })

        const user = await app.dispatch(
            groupMessage({
                raw_message: '/help',
                user_id: 30000,
            })
        )
        const userText = messageText(app, user)

        expect(userText).toContain('/help')
        expect(userText).not.toContain('/utter')
        expect(userText).not.toContain('/plugin')

        const superadmin = await app.dispatch(
            groupMessage({
                raw_message: '/help',
                user_id: 10000,
            })
        )
        const superadminText = messageText(app, superadmin)

        expect(superadminText).toContain('/utter')
        expect(superadminText).toContain('/utter raw')
        expect(superadminText).toContain('/plugin install')
        expect(superadminText).toContain('/plugin list')

        await app.stop()
    })

    it('shows command params in help', async () => {
        const askPlugin = definePlugin({
            manifest: {
                id: 'ask',
                version: '1.0.0',
                defaultEnabled: true,
                configSchema: z.object({}).strict(),
            },
            setup(ctx) {
                ctx.commands.register(
                    {
                        name: 'ask',
                        permission: 'User',
                        description: '提问',
                        params: '<question:string> [count:number=1]',
                    },
                    async () => {}
                )
            },
        })
        const app = await createTestApp({
            plugins: [corePlugin, askPlugin],
        })

        const result = await app.dispatch(
            groupMessage({
                raw_message: '/help',
                user_id: 30000,
            })
        )

        expect(
            messageText(app, result)
                .replaceAll('&#91;', '[')
                .replaceAll('&#93;', ']')
        ).toContain('/ask <question> [count] - 提问')

        await app.stop()
    })

    it('shows plugin status without secrets', async () => {
        const app = await createTestApp({
            plugins: [corePlugin],
            pluginConfigs: {
                core: { enabled: true },
            },
        })

        const result = await app.dispatch(
            groupMessage({ raw_message: '/status' })
        )
        const text = messageText(app, result)

        expect(text).toContain('运行时长')
        expect(text).toContain('core: enabled')

        await app.stop()
    })
})
