import type { JsBot } from "../../bot";

class PluginRegister {
    register(bot: JsBot) {
        const registration = bot.registrations
        const disposers: Array<() => void> = []
        try {
            for (const middleware of registration.middlewares) {
                disposers.push(bot.client.use(middleware))
            }
            for (const [, meta] of registration.commands) {
                disposers.push(bot.client.command(meta.name, meta.handler, {
                    prefixes: meta.prefixes
                }))
            }
            for (const meta of registration.handlers) {
                switch (meta.type) {
                    case 'notice':
                        disposers.push(meta.notice_type
                            ? bot.client.onNotice(meta.notice_type, meta.handler)
                            : bot.client.onNotice(meta.handler))
                        break
                    case 'request':
                        disposers.push(meta.request_type
                            ? bot.client.onRequest(meta.request_type, meta.handler)
                            : bot.client.onRequest(meta.handler))
                        break
                    case 'message':
                        switch (meta.message_type) {
                            case 'group':
                                disposers.push(bot.client.onGroupMessage(meta.handler))
                                break
                            case 'private':
                                disposers.push(bot.client.onPrivateMessage(meta.handler))
                                break
                            default:
                                disposers.push(bot.client.onMessage(meta.handler))
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
