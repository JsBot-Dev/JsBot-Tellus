import { describe, expect, it, vi } from 'vitest'
import { adminPlugin } from '../../src/plugins/admin/index.js'
import type { PluginInstaller } from '../../src/core/plugin/types.js'
import { groupMessage } from '../helpers/events.js'
import { createTestApp } from '../helpers/test-app.js'

function sentMessages(sent: Array<{ message: unknown }>): string[] {
    return sent.map((item) => String(item.message))
}

function createInstaller(
    overrides: Partial<PluginInstaller> = {}
): PluginInstaller {
    return {
        enabled: true,
        list: vi.fn(async () => []),
        install: vi.fn(async (spec: string) => ({
            packageName: spec,
            version: '1.0.0',
            pluginIds: [spec],
        })),
        remove: vi.fn(async (target: string) => ({
            packageName: target,
            pluginIds: [target],
            warnings: [],
        })),
        update: vi.fn(async () => ({
            updated: [],
            failed: [],
        })),
        ...overrides,
    }
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

    describe('/plugin', () => {
        it('lists installed packages for admins', async () => {
            const installer = createInstaller({
                list: vi.fn(async () => [
                    {
                        packageName: 'demo-plugin',
                        version: '1.2.3',
                        spec: 'demo-plugin',
                        pluginIds: ['demo'],
                        installedAt: '2026-01-01T00:00:00.000Z',
                        loaded: true,
                    },
                ]),
            })
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [],
                    admin: [20000],
                },
                installer,
            })

            await app.dispatch(
                groupMessage({
                    raw_message: '/plugin list',
                    user_id: 20000,
                })
            )

            const message = sentMessages(app.client.sent).at(-1) ?? ''

            expect(message).toContain('已安装 1 个插件包')
            expect(message).toContain('demo-plugin@1.2.3')
            expect(message).toContain('已加载')

            await app.stop()
        })

        it('requires superadmin for install, remove and update', async () => {
            const installer = createInstaller()
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [],
                    admin: [20000],
                },
                installer,
            })

            for (const command of [
                '/plugin install demo-plugin',
                '/plugin remove demo-plugin',
                '/plugin update',
            ]) {
                await app.dispatch(
                    groupMessage({
                        raw_message: command,
                        user_id: 20000,
                    })
                )
            }

            expect(sentMessages(app.client.sent)).toEqual([
                '只有 SuperAdmin 可以安装、卸载或更新插件包。',
                '只有 SuperAdmin 可以安装、卸载或更新插件包。',
                '只有 SuperAdmin 可以安装、卸载或更新插件包。',
            ])
            expect(installer.install).not.toHaveBeenCalled()
            expect(installer.remove).not.toHaveBeenCalled()
            expect(installer.update).not.toHaveBeenCalled()

            await app.stop()
        })

        it('installs a package for superadmins', async () => {
            const installer = createInstaller({
                install: vi.fn(async () => ({
                    packageName: 'demo-plugin',
                    version: '1.0.0',
                    pluginIds: ['demo'],
                })),
            })
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [10000],
                    admin: [],
                },
                installer,
            })

            await app.dispatch(
                groupMessage({
                    raw_message: '/plugin install demo-plugin@1.0.0',
                    user_id: 10000,
                })
            )
            await app.drain()

            expect(installer.install).toHaveBeenCalledWith(
                'demo-plugin@1.0.0',
                expect.any(AbortSignal)
            )
            expect(sentMessages(app.client.sent)).toEqual([
                '正在安装 demo-plugin@1.0.0 ...',
                '✅ 已安装 demo-plugin@1.0.0（插件 id: demo）。重启后生效。',
            ])

            await app.stop()
        })

        it('reports install failures', async () => {
            const installer = createInstaller({
                install: vi.fn(async () => {
                    throw new Error('boom')
                }),
            })
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [10000],
                    admin: [],
                },
                installer,
            })

            await app.dispatch(
                groupMessage({
                    raw_message: '/plugin install demo-plugin',
                    user_id: 10000,
                })
            )
            await app.drain()

            expect(sentMessages(app.client.sent).at(-1)).toBe(
                '❌ 安装失败：boom'
            )

            await app.stop()
        })

        it('surfaces removal warnings', async () => {
            const installer = createInstaller({
                remove: vi.fn(async () => ({
                    packageName: 'demo-plugin',
                    pluginIds: ['demo'],
                    warnings: [
                        '配置里的 plugins.demo 仍然存在，重启前请删除，否则会因未知插件 ID 启动失败',
                    ],
                })),
            })
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [10000],
                    admin: [],
                },
                installer,
            })

            await app.dispatch(
                groupMessage({
                    raw_message: '/plugin remove demo',
                    user_id: 10000,
                })
            )
            await app.drain()

            const message = sentMessages(app.client.sent).at(-1) ?? ''

            expect(message).toContain('已卸载 demo-plugin')
            expect(message).toContain('plugins.demo')

            await app.stop()
        })

        it('reports update results', async () => {
            const installer = createInstaller({
                update: vi.fn(async () => ({
                    updated: [
                        {
                            packageName: 'ok-plugin',
                            version: '2.0.0',
                            pluginIds: ['ok'],
                        },
                    ],
                    failed: [
                        {
                            packageName: 'bad-plugin',
                            message: 'not found',
                        },
                    ],
                })),
            })
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [10000],
                    admin: [],
                },
                installer,
            })

            await app.dispatch(
                groupMessage({
                    raw_message: '/plugin update',
                    user_id: 10000,
                })
            )
            await app.drain()

            expect(installer.update).toHaveBeenCalledWith(
                undefined,
                expect.any(AbortSignal)
            )

            const message = sentMessages(app.client.sent).at(-1) ?? ''

            expect(message).toContain('ok-plugin@2.0.0')
            expect(message).toContain('bad-plugin：not found')

            await app.stop()
        })

        it('reports when there is nothing to update', async () => {
            const installer = createInstaller()
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [10000],
                    admin: [],
                },
                installer,
            })

            await app.dispatch(
                groupMessage({
                    raw_message: '/plugin update',
                    user_id: 10000,
                })
            )
            await app.drain()

            expect(sentMessages(app.client.sent).at(-1)).toBe(
                '没有可更新的插件包。'
            )

            await app.stop()
        })

        it('reports when the installer is disabled', async () => {
            const installer = createInstaller({ enabled: false })
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [10000],
                    admin: [],
                },
                installer,
            })

            await app.dispatch(
                groupMessage({
                    raw_message: '/plugin install demo-plugin',
                    user_id: 10000,
                })
            )

            expect(sentMessages(app.client.sent).at(-1)).toBe(
                '插件安装功能未启用（installer.enabled=false）。'
            )
            expect(installer.install).not.toHaveBeenCalled()

            await app.stop()
        })
    })
})
