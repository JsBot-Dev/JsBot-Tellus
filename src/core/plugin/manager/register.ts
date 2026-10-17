import { isGroupMessageEvent, type SnowLumaEvent } from '@snowluma/sdk'
import { isPluginEnableInGroup } from '../../../utils/enable'
import type { JsBot } from '../../bot'

class PluginRegister {
    register(bot: JsBot) {
        const registration = bot.registrations
        const disposers: Array<() => void> = []
        const isEnabledForEvent = (plugin: string, event: SnowLumaEvent) => {
            const groupId = (event as { group_id?: number }).group_id
            return (
                groupId === undefined ||
                isPluginEnableInGroup(bot.config, plugin, groupId)
            )
        }
        try {
            for (const meta of registration.middlewares) {
                disposers.push(
                    bot.client.use((event, ctx, next) => {
                        if (isGroupMessageEvent(event))
                            if (
                                !isPluginEnableInGroup(
                                    bot.config,
                                    meta.plugin,
                                    event.group_id
                                )
                            )
                                return next()
                        return meta.handler(event, ctx, next)
                    })
                )
            }
            for (const [, meta] of registration.commands) {
                disposers.push(
                    bot.client.command(
                        meta.name,
                        async (event, ctx, match) => {
                            if (isGroupMessageEvent(event))
                                if (
                                    !isPluginEnableInGroup(
                                        bot.config,
                                        meta.plugin,
                                        event.group_id
                                    )
                                )
                                    return
                            try {
                                await meta.handler(event, ctx, match)
                            } finally {
                                ctx.stopPropagation()
                            }
                        },
                        {
                            prefixes: meta.prefixes,
                        }
                    )
                )
            }
            for (const meta of registration.handlers) {
                switch (meta.type) {
                    case 'notice':
                        disposers.push(
                            meta.notice_type
                                ? bot.client.onNotice(
                                      meta.notice_type,
                                      (event, ctx) =>
                                          isEnabledForEvent(meta.plugin, event)
                                              ? meta.handler(event, ctx)
                                              : undefined
                                  )
                                : bot.client.onNotice((event, ctx) =>
                                      isEnabledForEvent(meta.plugin, event)
                                          ? meta.handler(event, ctx)
                                          : undefined
                                  )
                        )
                        break
                    case 'request':
                        disposers.push(
                            meta.request_type
                                ? bot.client.onRequest(
                                      meta.request_type,
                                      (event, ctx) =>
                                          isEnabledForEvent(meta.plugin, event)
                                              ? meta.handler(event, ctx)
                                              : undefined
                                  )
                                : bot.client.onRequest((event, ctx) =>
                                      isEnabledForEvent(meta.plugin, event)
                                          ? meta.handler(event, ctx)
                                          : undefined
                                  )
                        )
                        break
                    case 'message':
                        switch (meta.message_type) {
                            case 'group':
                                disposers.push(
                                    bot.client.onGroupMessage((event, ctx) => {
                                        if (isGroupMessageEvent(event))
                                            if (
                                                !isPluginEnableInGroup(
                                                    bot.config,
                                                    meta.plugin,
                                                    event.group_id
                                                )
                                            )
                                                return
                                        return meta.handler(event, ctx)
                                    })
                                )
                                break
                            case 'private':
                                disposers.push(
                                    bot.client.onPrivateMessage(meta.handler)
                                )
                                break
                            default:
                                disposers.push(
                                    bot.client.onMessage((event, ctx) => {
                                        if (isGroupMessageEvent(event))
                                            if (
                                                !isPluginEnableInGroup(
                                                    bot.config,
                                                    meta.plugin,
                                                    event.group_id
                                                )
                                            )
                                                return
                                        return meta.handler(event, ctx)
                                    })
                                )
                        }
                }
            }
        } catch (error) {
            for (const dispose of disposers.reverse()) dispose()
            throw error
        }
        return disposers
    }
}

export { PluginRegister }
