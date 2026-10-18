import type { JsBot } from '../bot'
import logger from '../logger/logger'
import type { PluginLevel } from '../types/type'

class JsBotBasePlugin {
    static readonly level: PluginLevel = 'Custom'
    static readonly ignore: boolean = false
    static readonly name: string = this.constructor.name
    logger: logger
    constructor(readonly bot: JsBot) {
        this.logger = new logger(`[Bot::Plugin::${this.constructor.name}]`)
    }
    get_kv(key: string) {
        return this.bot.plugiDb!.get(this.constructor.name, key)
    }
    set_kv(key: string, value: any) {
        this.bot.plugiDb!.set(this.constructor.name, key, value)
    }
}

export { JsBotBasePlugin }
