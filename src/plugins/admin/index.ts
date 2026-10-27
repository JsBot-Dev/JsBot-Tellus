import { z } from 'zod'
import { definePlugin } from '../../core/index.js'

const PLUGIN_USAGE = `用法：
/plugin install <npm包[@版本|tag]>
/plugin list
/plugin remove <包名|插件id> [--force]
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
                    autoEscape: true,
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
                    autoEscape: false,
                })
            }
        )

        ctx.commands.register(
            {
                name: 'plugin',
                permission: 'SuperAdmin',
                description: '管理已安装的插件包',
            },
            async (_event, context, match) => {
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
                    try {
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
                            [
                                `已安装 ${packages.length} 个插件包：`,
                                ...lines,
                            ].join('\n'),
                            { quote: false }
                        )
                    } catch (error) {
                        await context.send(
                            `❌ 读取插件包失败：${errorMessage(error)}`,
                            { quote: false }
                        )
                    }
                    return
                }

                if (sub !== 'install' && sub !== 'remove' && sub !== 'update') {
                    await context.send(PLUGIN_USAGE, { quote: false })
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
                            const lines = [
                                `✅ 已安装 ${result.packageName}@${result.version}（插件 id: ${formatIds(result.pluginIds)}）。`,
                            ]

                            for (const warning of result.warnings) {
                                lines.push(`⚠️ ${warning}`)
                            }

                            lines.push(
                                result.warnings.length === 0
                                    ? '正在重启。'
                                    : '请处理以上问题后手动重启。'
                            )

                            await ctx.api.send(sessionId, lines.join('\n'), {
                                quote: false,
                            })

                            if (result.warnings.length === 0) {
                                ctx.core.restart()
                            }
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
                            '用法：/plugin remove <包名|插件id> [--force]',
                            { quote: false }
                        )
                        return
                    }

                    const force = /(?:^|\s)--force(?:\s|$)/.test(argument)
                    const target = argument
                        .replace(/(?:^|\s)--force(?:\s|$)/, ' ')
                        .trim()

                    if (target.length === 0) {
                        await context.send(
                            '用法：/plugin remove <包名|插件id> [--force]',
                            { quote: false }
                        )
                        return
                    }

                    await context.send(`正在卸载 ${target} ...`, {
                        quote: false,
                    })

                    ctx.tasks.enqueue('plugin-installer', async (signal) => {
                        try {
                            const result = await installer.remove(
                                target,
                                signal,
                                { force }
                            )
                            const lines = [`✅ 已卸载 ${result.packageName}。`]

                            if (result.pluginIds.length > 0) {
                                lines.push(
                                    `插件 id: ${formatIds(result.pluginIds)}`
                                )
                            }

                            for (const warning of result.warnings) {
                                lines.push(`⚠️ ${warning}`)
                            }

                            if (result.warnings.length === 0) {
                                lines.push('正在重启。')
                            } else {
                                lines.push('请处理以上问题后手动重启。')
                            }

                            await ctx.api.send(sessionId, lines.join('\n'), {
                                quote: false,
                            })

                            if (result.warnings.length === 0) {
                                ctx.core.restart()
                            }
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
                        const warnings = result.updated.flatMap(
                            (item) => item.warnings
                        )

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

                        for (const warning of warnings) {
                            lines.push(`⚠️ ${warning}`)
                        }

                        if (lines.length === 0) {
                            lines.push('没有可更新的插件包。')
                        }

                        if (result.updated.length > 0) {
                            lines.push(
                                warnings.length === 0
                                    ? '正在重启。'
                                    : '请处理以上问题后手动重启。'
                            )
                        }

                        await ctx.api.send(sessionId, lines.join('\n'), {
                            quote: false,
                        })

                        if (
                            result.updated.length > 0 &&
                            warnings.length === 0
                        ) {
                            ctx.core.restart()
                        }
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
