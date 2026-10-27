import { z } from 'zod'
import { definePlugin } from '../../core/index.js'

const PLUGIN_USAGE = `用法：
/plugin install <npm包[@版本|tag]>
/plugin list
/plugin remove <包名|插件id>
/plugin update [包名]`

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function formatIds(pluginIds: string[]): string {
    return pluginIds.length > 0 ? pluginIds.join(', ') : '未记录'
}

export const adminPlugin = definePlugin({
    manifest: {
        id: 'admin',
        version: '2.0.0',
        description: 'Administrative message commands',
        priority: 900,
        defaultEnabled: true,
        configSchema: z.object({}).strict(),
    },

    setup(ctx) {
        ctx.commands.register(
            {
                name: 'utter',
                permission: 'Admin',
                description: '向当前会话发送文本',
            },
            async (_event, context, match) => {
                if (!match.rest) {
                    await context.send('用法：/utter <文本>')
                    return
                }

                await context.send(match.rest, {
                    quote: false,
                })
            }
        )

        ctx.commands.register(
            {
                name: 'utter.raw',
                permission: 'SuperAdmin',
                description: '发送原始 CQ 消息',
            },
            async (_event, context, match) => {
                if (!match.rest) {
                    await context.send('用法：/utter.raw <CQ 消息>')
                    return
                }

                await context.send(match.rest, {
                    quote: false,
                })
            }
        )

        ctx.commands.register(
            {
                name: 'plugin',
                permission: 'Admin',
                description: '管理已安装的插件包',
            },
            async (event, context, match) => {
                const sub = (match.args[0] ?? '').toLowerCase()
                const argument = match.rest
                    .slice(match.args[0]?.length ?? 0)
                    .trim()
                const installer = ctx.core.installer
                const sessionId = context.sessionId

                if (sub.length === 0 || sub === 'help') {
                    await context.send(PLUGIN_USAGE, { quote: false })
                    return
                }

                if (sub === 'list') {
                    const packages = await installer.list()

                    if (packages.length === 0) {
                        await context.send('没有已安装的插件包。', {
                            quote: false,
                        })
                        return
                    }

                    const lines = packages.map((item) => {
                        const status = item.loaded ? '已加载' : '重启后生效'
                        return `- ${item.packageName}@${item.version} → ${formatIds(item.pluginIds)}（${status}）`
                    })

                    await context.send(
                        [`已安装 ${packages.length} 个插件包：`, ...lines].join(
                            '\n'
                        ),
                        { quote: false }
                    )
                    return
                }

                if (sub !== 'install' && sub !== 'remove' && sub !== 'update') {
                    await context.send(PLUGIN_USAGE, { quote: false })
                    return
                }

                const role = ctx.core.roles.roleOf(event.user_id)

                if (!ctx.core.roles.can(role, 'SuperAdmin')) {
                    await context.send(
                        '只有 SuperAdmin 可以安装、卸载或更新插件包。',
                        { quote: false }
                    )
                    return
                }

                if (!installer.enabled) {
                    await context.send(
                        '插件安装功能未启用（installer.enabled=false）。',
                        { quote: false }
                    )
                    return
                }

                if (sub === 'install') {
                    if (argument.length === 0) {
                        await context.send(
                            '用法：/plugin install <npm包[@版本|tag]>',
                            { quote: false }
                        )
                        return
                    }

                    await context.send(`正在安装 ${argument} ...`, {
                        quote: false,
                    })

                    ctx.tasks.enqueue('plugin-installer', async (signal) => {
                        try {
                            const result = await installer.install(
                                argument,
                                signal
                            )

                            await ctx.api.send(
                                sessionId,
                                `✅ 已安装 ${result.packageName}@${result.version}（插件 id: ${formatIds(result.pluginIds)}）。重启后生效。`,
                                { quote: false }
                            )
                        } catch (error) {
                            await ctx.api.send(
                                sessionId,
                                `❌ 安装失败：${errorMessage(error)}`,
                                { quote: false }
                            )
                        }
                    })
                    return
                }

                if (sub === 'remove') {
                    if (argument.length === 0) {
                        await context.send(
                            '用法：/plugin remove <包名|插件id>',
                            { quote: false }
                        )
                        return
                    }

                    await context.send(`正在卸载 ${argument} ...`, {
                        quote: false,
                    })

                    ctx.tasks.enqueue('plugin-installer', async (signal) => {
                        try {
                            const result = await installer.remove(
                                argument,
                                signal
                            )
                            const lines = [
                                `✅ 已卸载 ${result.packageName}。重启后生效。`,
                            ]

                            if (result.pluginIds.length > 0) {
                                lines.push(
                                    `插件 id: ${formatIds(result.pluginIds)}`
                                )
                            }

                            for (const warning of result.warnings) {
                                lines.push(`⚠️ ${warning}`)
                            }

                            await ctx.api.send(sessionId, lines.join('\n'), {
                                quote: false,
                            })
                        } catch (error) {
                            await ctx.api.send(
                                sessionId,
                                `❌ 卸载失败：${errorMessage(error)}`,
                                { quote: false }
                            )
                        }
                    })
                    return
                }

                await context.send(
                    argument.length > 0
                        ? `正在更新 ${argument} ...`
                        : '正在更新全部插件包 ...',
                    { quote: false }
                )

                ctx.tasks.enqueue('plugin-installer', async (signal) => {
                    try {
                        const result = await installer.update(
                            argument.length > 0 ? argument : undefined,
                            signal
                        )
                        const lines: string[] = []

                        for (const item of result.updated) {
                            lines.push(
                                `✅ ${item.packageName}@${item.version}（插件 id: ${formatIds(item.pluginIds)}）`
                            )
                        }

                        for (const item of result.failed) {
                            lines.push(
                                `❌ ${item.packageName}：${item.message}`
                            )
                        }

                        if (lines.length === 0) {
                            lines.push('没有可更新的插件包。')
                        }

                        if (result.updated.length > 0) {
                            lines.push('重启后生效。')
                        }

                        await ctx.api.send(sessionId, lines.join('\n'), {
                            quote: false,
                        })
                    } catch (error) {
                        await ctx.api.send(
                            sessionId,
                            `❌ 更新失败：${errorMessage(error)}`,
                            { quote: false }
                        )
                    }
                })
            }
        )
    },
})
