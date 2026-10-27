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
            warnings: [],
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
        expect(app.client.sent[0]?.options).toEqual({
            autoEscape: true,
        })

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
                raw_message: '/utter raw [CQ:face,id=1]',
                user_id: 20000,
            })
        )

        expect(sentMessages(app.client.sent)[0]).toContain('权限不足')

        await app.dispatch(
            groupMessage({
                raw_message: '/utter raw [CQ:face,id=1]',
                user_id: 10000,
            })
        )

        expect(sentMessages(app.client.sent).at(-1)).toBe('[CQ:face,id=1]')
        expect(app.client.sent.at(-1)?.options).toEqual({
            autoEscape: false,
        })

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
        it('lists installed packages for superadmins', async () => {
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
                    superadmin: [20000],
                    admin: [],
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

        it('reports list failures', async () => {
            const installer = createInstaller({
                list: vi.fn(async () => {
                    throw new Error('安装状态文件无法解析')
                }),
            })
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [20000],
                    admin: [],
                },
                installer,
            })

            await app.dispatch(
                groupMessage({
                    raw_message: '/plugin list',
                    user_id: 20000,
                })
            )

            expect(sentMessages(app.client.sent).at(-1)).toBe(
                '❌ 读取插件包失败：安装状态文件无法解析'
            )

            await app.stop()
        })

        it('requires superadmin for every subcommand', async () => {
            const installer = createInstaller()
            const onRestart = vi.fn()
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [],
                    admin: [20000],
                },
                installer,
                onRestart,
            })

            const commands = [
                '/plugin',
                '/plugin help',
                '/plugin list',
                '/plugin install demo-plugin',
                '/plugin remove demo-plugin',
                '/plugin update',
            ]

            for (const command of commands) {
                await app.dispatch(
                    groupMessage({
                        raw_message: command,
                        user_id: 20000,
                    })
                )
            }

            expect(sentMessages(app.client.sent)).toEqual(
                commands.map(() => '权限不足：需要 SuperAdmin，当前 Admin')
            )
            expect(installer.list).not.toHaveBeenCalled()
            expect(installer.install).not.toHaveBeenCalled()
            expect(installer.remove).not.toHaveBeenCalled()
            expect(installer.update).not.toHaveBeenCalled()
            expect(onRestart).not.toHaveBeenCalled()

            await app.stop()
        })

        it('shows usage for the group root and unknown subcommands', async () => {
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [10000],
                    admin: [],
                },
            })

            for (const command of [
                '/plugin',
                '/plugin help',
                '/plugin unknown',
            ]) {
                await app.dispatch(
                    groupMessage({
                        raw_message: command,
                        user_id: 10000,
                    })
                )
            }

            const messages = sentMessages(app.client.sent)

            expect(messages).toHaveLength(3)
            expect(messages.every((message) => message.includes('用法'))).toBe(
                true
            )

            await app.stop()
        })

        it('installs a package for superadmins', async () => {
            const installer = createInstaller({
                install: vi.fn(async () => ({
                    packageName: 'demo-plugin',
                    version: '1.0.0',
                    pluginIds: ['demo'],
                    warnings: [],
                })),
            })
            const onRestart = vi.fn()
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [10000],
                    admin: [],
                },
                installer,
                onRestart,
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
                '✅ 已安装 demo-plugin@1.0.0（插件 id: demo）。\n正在重启。',
            ])
            expect(onRestart).toHaveBeenCalledTimes(1)

            await app.stop()
        })

        it('surfaces install warnings and skips restart', async () => {
            const installer = createInstaller({
                install: vi.fn(async () => ({
                    packageName: 'demo-plugin',
                    version: '1.0.0',
                    pluginIds: ['demo'],
                    warnings: [
                        '配置里的 plugins.old 仍然存在，重启前请删除，否则会因未知插件 ID 启动失败',
                    ],
                })),
            })
            const onRestart = vi.fn()
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [10000],
                    admin: [],
                },
                installer,
                onRestart,
            })

            await app.dispatch(
                groupMessage({
                    raw_message: '/plugin install demo-plugin',
                    user_id: 10000,
                })
            )
            await app.drain()

            const message = sentMessages(app.client.sent).at(-1) ?? ''

            expect(message).toContain('已安装 demo-plugin@1.0.0')
            expect(message).toContain('plugins.old')
            expect(message).toContain('请处理以上问题后手动重启')
            expect(onRestart).not.toHaveBeenCalled()

            await app.stop()
        })

        it('reports install failures', async () => {
            const installer = createInstaller({
                install: vi.fn(async () => {
                    throw new Error('boom')
                }),
            })
            const onRestart = vi.fn()
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [10000],
                    admin: [],
                },
                installer,
                onRestart,
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
            expect(onRestart).not.toHaveBeenCalled()

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
            const onRestart = vi.fn()
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [10000],
                    admin: [],
                },
                installer,
                onRestart,
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
            expect(message).toContain('请处理以上问题后手动重启')
            expect(onRestart).not.toHaveBeenCalled()

            await app.stop()
        })

        it('restarts after a clean removal', async () => {
            const installer = createInstaller()
            const onRestart = vi.fn()
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [10000],
                    admin: [],
                },
                installer,
                onRestart,
            })

            await app.dispatch(
                groupMessage({
                    raw_message: '/plugin remove demo-plugin',
                    user_id: 10000,
                })
            )
            await app.drain()

            expect(sentMessages(app.client.sent).at(-1)).toBe(
                '✅ 已卸载 demo-plugin。\n插件 id: demo-plugin\n正在重启。'
            )
            expect(onRestart).toHaveBeenCalledTimes(1)

            await app.stop()
        })

        it('passes --force through to the installer', async () => {
            const remove = vi.fn(async () => ({
                packageName: 'demo-plugin',
                pluginIds: ['demo-plugin'],
                warnings: [],
            }))
            const installer = createInstaller({ remove })
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
                    raw_message: '/plugin remove demo-plugin --force',
                    user_id: 10000,
                })
            )
            await app.drain()

            expect(remove).toHaveBeenCalledWith(
                'demo-plugin',
                expect.anything(),
                { force: true }
            )

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
                            warnings: [],
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
            const onRestart = vi.fn()
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [10000],
                    admin: [],
                },
                installer,
                onRestart,
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
            expect(message).toContain('正在重启。')
            expect(onRestart).toHaveBeenCalledTimes(1)

            await app.stop()
        })

        it('surfaces update warnings and skips restart', async () => {
            const installer = createInstaller({
                update: vi.fn(async () => ({
                    updated: [
                        {
                            packageName: 'demo-plugin',
                            version: '2.0.0',
                            pluginIds: ['demo'],
                            warnings: [
                                '配置里的 plugins.old 仍然存在，重启前请删除，否则会因未知插件 ID 启动失败',
                            ],
                        },
                    ],
                    failed: [],
                })),
            })
            const onRestart = vi.fn()
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [10000],
                    admin: [],
                },
                installer,
                onRestart,
            })

            await app.dispatch(
                groupMessage({
                    raw_message: '/plugin update',
                    user_id: 10000,
                })
            )
            await app.drain()

            const message = sentMessages(app.client.sent).at(-1) ?? ''

            expect(message).toContain('demo-plugin@2.0.0')
            expect(message).toContain('plugins.old')
            expect(message).toContain('请处理以上问题后手动重启')
            expect(onRestart).not.toHaveBeenCalled()

            await app.stop()
        })

        it('reports when there is nothing to update', async () => {
            const installer = createInstaller()
            const onRestart = vi.fn()
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [10000],
                    admin: [],
                },
                installer,
                onRestart,
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
            expect(onRestart).not.toHaveBeenCalled()

            await app.stop()
        })

        it('reports when the installer is disabled', async () => {
            const installer = createInstaller({ enabled: false })
            const onRestart = vi.fn()
            const app = await createTestApp({
                plugins: [adminPlugin],
                roles: {
                    superadmin: [10000],
                    admin: [],
                },
                installer,
                onRestart,
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
            expect(onRestart).not.toHaveBeenCalled()

            await app.stop()
        })
    })
})
