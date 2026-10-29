import { z } from 'zod'
import { definePlugin } from '../../core/index.js'

function formatUptime(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`
    }

    if (minutes > 0) {
        return `${minutes}m ${seconds}s`
    }

    return `${seconds}s`
}

export const corePlugin = definePlugin({
    manifest: {
        id: 'core',
        version: '2.0.0',
        description: 'Core commands and status services',
        priority: 1000,
        defaultEnabled: true,
        configSchema: z.object({}).strict(),
    },
    setup(ctx) {
        ctx.commands.register(
            {
                name: 'help',
                aliases: ['h'],
                permission: 'User',
                description: '显示可用命令',
            },
            async (event, context) => {
                const role = ctx.core.roles.roleOf(event.user_id)
                const commands = ctx.core.commands
                    .list(event)
                    .filter((command) =>
                        ctx.core.roles.can(role, command.permission)
                    )
                    .map((command) => {
                        const usage =
                            command.usage !== undefined
                                ? ` ${command.usage}`
                                : ''
                        const aliases =
                            command.aliases.length > 0
                                ? ` (${command.aliases
                                      .map((alias) => `/${alias}`)
                                      .join(', ')})`
                                : ''
                        const description = command.description
                            ? ` - ${command.description}`
                            : ''

                        return `/${command.name}${usage}${aliases}${description}`
                    })

                await context.send(`可用命令：\n${commands.join('\n')}`)
            }
        )

        ctx.commands.register(
            {
                name: 'status',
                aliases: ['s'],
                permission: 'User',
                description: '显示运行状态',
            },
            async (_event, context) => {
                const plugins = ctx.core.plugins
                    .list()
                    .map(
                        (plugin) =>
                            `${plugin.id}: ${
                                plugin.enabled
                                    ? plugin.loaded
                                        ? 'enabled'
                                        : 'pending'
                                    : 'disabled'
                            }`
                    )

                await context.send(
                    [
                        `运行时长：${formatUptime(ctx.core.uptime())}`,
                        `插件：\n${plugins.join('\n')}`,
                    ].join('\n')
                )
            }
        )

        ctx.commands.register(
            {
                name: 'role',
                permission: 'User',
                description: '显示当前角色',
            },
            async (event, context) => {
                const role = ctx.core.roles.roleOf(event.user_id)

                await context.send(`当前角色：${role}`)
            }
        )
    },
})
